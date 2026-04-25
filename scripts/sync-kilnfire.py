#!/usr/bin/env python3
"""Sync past classes from Kilnfire into the MPS-weekly-task DB.

Flow:
  1. Log in to Kilnfire (env: KILNFIRE_URL/USER/PASS).
  2. Pull /classes/admin/planning/data — full class list.
  3. Filter to classes that have ended in the past N days (default 14)
     and aren't already in our DB.
  4. For each: map template name → our class_type id, then POST
     /api/state addClass on the dashboard's API. addClass triggers
     generation automatically.
  5. Record the run in the kilnfire_scrapes audit table via /api/admin.

Usage:
  python scripts/sync-kilnfire.py
  python scripts/sync-kilnfire.py --dry-run        # log only, no writes
  python scripts/sync-kilnfire.py --since 30       # look back 30 days
  python scripts/sync-kilnfire.py --mock data.json # use a saved planning payload
"""

import argparse, json, os, sys, datetime, re
from pathlib import Path

# Allow importing the local kilnfire package
sys.path.insert(0, str(Path(__file__).parent))
from kilnfire.client import login_session, fetch_planning  # noqa: E402

import requests


# ── Configuration ───────────────────────────────────────────────

# Substring (lowercased) → our class_type id. Order matters: longer keys win.
TEMPLATE_PATTERNS = [
    ("matcha set",   "matcha-set"),
    ("matcha bowl",  "matcha-bowl"),
    ("clay date",    "clay-date"),
    ("mug workshop", "mug"),
    ("mug",          "mug"),
    ("taster",       "taster"),
]

# Names we use for `classes.type` — must match the seed in seed-class-types.js
TYPE_NAMES = {
    "taster":      "Taster Class",
    "matcha-bowl": "Matcha Bowl",
    "matcha-set":  "Matcha Set (2-week course)",
    "mug":         "Mug Workshop",
    "clay-date":   "Clay Date for Two",
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run",  action="store_true", help="Don't POST to the API; print only.")
    p.add_argument("--since",    type=int, default=14, help="Look back N days (default 14).")
    p.add_argument("--mock",     type=str, default=None, help="Path to a saved planning JSON to use instead of live scrape.")
    p.add_argument("--base-url", type=str, default=os.environ.get("BASE_URL"))
    p.add_argument("--password", type=str, default=os.environ.get("STUDIO_PASSWORD"))
    return p.parse_args()


def map_template(template_name: str) -> str | None:
    n = (template_name or "").lower()
    for pattern, type_id in TEMPLATE_PATTERNS:
        if pattern in n:
            return type_id
    return None


def parse_fill(fill: str) -> int:
    """Parse 'X / Y' → X (current attendees)."""
    if not fill:
        return 0
    m = re.match(r"\s*(\d+)\s*/\s*\d+", fill)
    return int(m.group(1)) if m else 0


def parse_kf_date(s: str) -> datetime.date | None:
    """Kilnfire's CSV uses M/D/YYYY (or D/M/YYYY?). Try a few formats."""
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def monday_of(date: datetime.date) -> datetime.date:
    return date - datetime.timedelta(days=date.weekday())


def fetch_existing_classes(base_url: str, password: str, week_keys: set[str]) -> set[str]:
    """Return the set of kilnfire_external_ids already recorded for the
    given weeks. Avoids double-inserting on re-runs."""
    seen: set[str] = set()
    for wk in week_keys:
        r = requests.get(
            f"{base_url}/api/state",
            headers={"Authorization": f"Bearer {password}"},
            params={"week": wk},
            timeout=20,
        )
        r.raise_for_status()
        for c in r.json().get("classes", []):
            ext = c.get("kilnfireExternalId")
            if ext:
                seen.add(str(ext))
    return seen


def post_class(base_url: str, password: str, payload: dict) -> dict:
    r = requests.post(
        f"{base_url}/api/state",
        headers={"Authorization": f"Bearer {password}", "Content-Type": "application/json"},
        json={"op": "addClass", **payload},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def write_audit(base_url: str, password: str, audit: dict) -> None:
    # Audit row written via Supabase REST through a thin admin op; not
    # critical — best-effort log of the run.
    try:
        requests.post(
            f"{base_url}/api/admin",
            headers={"Authorization": f"Bearer {password}", "Content-Type": "application/json"},
            json={"op": "logKilnfireScrape", **audit},
            timeout=20,
        )
    except Exception as e:
        print(f"  (audit write failed: {e}; not fatal)")


def main():
    args = parse_args()

    if not args.base_url or not args.password:
        print("BASE_URL and STUDIO_PASSWORD must be set (env or --base-url/--password).")
        sys.exit(2)

    # ── Pull planning payload ──
    if args.mock:
        with open(args.mock) as f:
            planning = json.load(f)
        print(f"Loaded mock planning data from {args.mock}")
    else:
        if not all(k in os.environ for k in ("KILNFIRE_URL", "KILNFIRE_USER", "KILNFIRE_PASS")):
            print("KILNFIRE_URL / KILNFIRE_USER / KILNFIRE_PASS must be set for live scrape.")
            sys.exit(2)
        session, token, base = login_session()
        planning = fetch_planning(session, token, base)
        print(f"Fetched planning from {base}")

    classes = planning.get("classes") or planning.get("data") or planning
    if not isinstance(classes, list):
        print(f"Unexpected planning shape: {type(classes).__name__}")
        sys.exit(1)
    print(f"Total classes in payload: {len(classes)}")

    # ── Filter past N days, status finished, mappable template ──
    cutoff = datetime.date.today() - datetime.timedelta(days=args.since)
    candidates: list[dict] = []
    skipped: list[dict] = []

    for c in classes:
        # Accept multiple field-name shapes (the JSON endpoint and CSV
        # export use slightly different names; future-proof a bit).
        end_date_raw = c.get("end_date") or c.get("End Date") or c.get("class_end")
        end_date = parse_kf_date(end_date_raw) if isinstance(end_date_raw, str) else None
        if not end_date or end_date < cutoff or end_date > datetime.date.today():
            continue

        template = c.get("template") or c.get("Template") or c.get("name") or c.get("Class")
        type_id = map_template(template or "")
        if not type_id:
            skipped.append({"reason": "unmapped-template", "template": template, "kilnfire_id": c.get("ID")})
            continue

        kf_id = str(c.get("ID") or c.get("id") or c.get("class_id") or "")
        if not kf_id:
            skipped.append({"reason": "no-kilnfire-id", "template": template})
            continue

        attendees = parse_fill(c.get("Fill") or c.get("fill") or "")
        instructors = c.get("Instructors") or c.get("instructors") or ""
        # Take the first instructor mentioned, lowercased to match staff.id
        instructor = (instructors.split(",")[0].strip().lower().split()[0] if instructors else None)

        candidates.append({
            "kf_id":      kf_id,
            "template":   template,
            "type_id":    type_id,
            "type_name":  TYPE_NAMES[type_id],
            "class_date": end_date.isoformat(),
            "week_key":   monday_of(end_date).isoformat(),
            "instructor": instructor,
            "attendees":  attendees,
        })

    print(f"Filtered to {len(candidates)} candidate past classes (since {cutoff})")
    print(f"Skipped {len(skipped)} unmappable rows")

    # ── Skip already-recorded classes ──
    week_keys = {c["week_key"] for c in candidates}
    seen = fetch_existing_classes(args.base_url, args.password, week_keys) if week_keys else set()
    fresh = [c for c in candidates if c["kf_id"] not in seen]
    print(f"Of those, {len(fresh)} are not yet in our DB")

    # ── Insert ──
    inserted = 0
    errors: list[dict] = []
    for c in fresh:
        if args.dry_run:
            print(f"  DRY-RUN would insert {c['type_name']} on {c['class_date']} ({c['kf_id']}, ~{c['attendees']} attendees)")
            continue
        try:
            res = post_class(args.base_url, args.password, {
                "weekKey":            c["week_key"],
                "type":               c["type_name"],
                "date":               c["class_date"],
                "instructor":         c["instructor"],
                "kilnfireExternalId": c["kf_id"],
                "notes":              f"Auto-imported from Kilnfire ({c['attendees']} attendees)",
            })
            generation = res.get("generation") or {}
            print(f"  ✓ {c['type_name']} {c['class_date']} → {generation.get('totalTasks', 0)} tasks generated")
            inserted += 1
        except Exception as e:
            errors.append({"kf_id": c["kf_id"], "template": c["template"], "error": str(e)})
            print(f"  ✗ {c['type_name']} {c['class_date']}: {e}")

    # ── Audit row ──
    if not args.dry_run:
        write_audit(args.base_url, args.password, {
            "classes_pulled":   len(classes),
            "classes_inserted": inserted,
            "classes_skipped":  len(skipped),
            "errors":           skipped + errors,
        })

    print(f"\nDone — inserted {inserted}, skipped {len(skipped) + len(errors)}.")
    sys.exit(0 if not errors else 1)


if __name__ == "__main__":
    main()
