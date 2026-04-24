// Seeds the "Campaign Launch" template into the templates table.
// Usage:
//   node scripts/seed-campaign-template.js
//
// Requires BASE_URL and STUDIO_PASSWORD in .env.local (Playwright setup
// already loads these). Idempotent — re-running updates the existing
// template by name via the upsertTemplate op.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const BASE = process.env.BASE_URL;
const PW   = process.env.STUDIO_PASSWORD;

if (!BASE || !PW) {
  console.error('BASE_URL and STUDIO_PASSWORD must be set (in .env.local).');
  process.exit(1);
}

// Shape of each task entry:
//   { title, offset_days?, subsection?, default_owner?, notes? }
// offset_days is relative to target_date (negative = before). Content-schedule
// items use Day N → offset = N - 14, so Day 14 = day of launch, Day 1 = 13 days
// before. Planning tasks without a specific date are left unset and become
// deadline-less draft rows the owner fills in.

const template = {
  name:        'Campaign Launch',
  description: 'Multi-phase template for launching a new class or collab. Content schedule covers Day 1–14 leading up to launch.',
  sections: [
    {
      name: 'Planning',
      tasks: [
        { title: 'Confirm class names, descriptions, and schedule with Cielo', notes: 'Class name, description, and schedule.' },
        { title: 'Agree on roles between Nick and Cielo' },
        { title: 'Set a launch date and work backwards for deadlines' },
        { title: 'Decide on pricing (free, paid, sliding scale?)' },
      ],
    },
    {
      name: 'Registration / Sign-Up: Kilnfire',
      tasks: [
        { title: 'Set up a way for people to register' },
        { title: 'Test the sign-up flow before going live' },
        { title: 'Confirm how registration confirmations are sent' },
        { title: 'Confirm sign-ups are working' },
      ],
    },
    {
      name: 'Content Creation',
      tasks: [
        { title: 'Write class descriptions' },
        { title: 'Gather or create photos/videos for the campaign' },
        { title: 'Design graphics or promotional images' },
        { title: 'Write captions/copy for social media posts' },
        { title: 'Create a teaser video or highlight reel' },

        // Design assets subsection
        { subsection: 'Design Assets', title: 'Campaign Poster — static graphic / text poster for ads' },
        { subsection: 'Design Assets', title: '7 Static Graphics — IG version of poster, testimonial, social proof' },
        { subsection: 'Design Assets', title: '1 Carousel (e.g. gift guide)' },
        { subsection: 'Design Assets', title: '3 Reels — Campaign Teaser / Class Spotlight / Countdown / Last Chance' },
        { subsection: 'Design Assets', title: '5 Stories — Teaser Poll / Class Preview / Gift Guide / Countdown / Last Chance Reminder' },

        // 2-week content schedule — Day N ⇒ offset = N - 14
        { subsection: '2-Week Content Schedule', title: 'Day 1 — Campaign Teaser (Reel, IG + TikTok)',       offset_days: -13 },
        { subsection: '2-Week Content Schedule', title: 'Day 1 — Teaser Poll (Story, IG)',                   offset_days: -13 },
        { subsection: '2-Week Content Schedule', title: 'Day 3 — Campaign Poster (Static, IG + FB ad)',      offset_days: -11 },
        { subsection: '2-Week Content Schedule', title: 'Day 3 — Class Preview (Story from Reel, IG)',       offset_days: -11 },
        { subsection: '2-Week Content Schedule', title: 'Day 5 — Class Spotlight (Reel, IG + TikTok)',       offset_days:  -9 },
        { subsection: '2-Week Content Schedule', title: 'Day 5 — Gift Guide (Story, IG)',                    offset_days:  -9 },
        { subsection: '2-Week Content Schedule', title: 'Day 7 — Gift Guide Carousel (IG)',                  offset_days:  -7 },
        { subsection: '2-Week Content Schedule', title: 'Day 7 — IG Version of Poster (Static, IG)',         offset_days:  -7 },
        { subsection: '2-Week Content Schedule', title: 'Day 9 — Testimonial / Social Proof (Static, IG + FB)', offset_days: -5 },
        { subsection: '2-Week Content Schedule', title: 'Day 11 — Countdown Post (Reel, IG + TikTok)',       offset_days:  -3 },
        { subsection: '2-Week Content Schedule', title: 'Day 11 — Countdown Story (IG)',                     offset_days:  -3 },
        { subsection: '2-Week Content Schedule', title: 'Day 13 — Last Chance (Reel, IG + TikTok)',          offset_days:  -1 },
        { subsection: '2-Week Content Schedule', title: 'Day 14 — Last Chance Reminder (Story, IG)',         offset_days:   0 },
      ],
    },
    {
      name: 'Social Media',
      tasks: [
        { title: 'Plan a posting schedule leading up to launch (use 2-week schedule)' },
        { title: 'Coordinate posting plan with Cielo' },
        { title: 'Tag each other in posts to boost reach' },
        { title: 'Add a call-to-action to all posts' },
      ],
    },
    {
      name: 'Communication',
      tasks: [
        { title: 'Send announcement to existing audience (email list)' },
        { title: 'Ask friends/followers to share — group chats + Discord' },
        { title: 'Prepare answers to common questions' },
      ],
    },
    {
      name: 'Launch Day',
      tasks: [
        { title: 'Post on all agreed platforms', offset_days: 0 },
        { title: 'Respond to comments and DMs',   offset_days: 0 },
        { title: 'Monitor sign-ups',              offset_days: 0 },
      ],
    },
    {
      name: 'After Launch',
      tasks: [
        { title: 'Thank people who signed up',                              offset_days:  1 },
        { title: 'Gather feedback after first class (post-class survey)',   offset_days:  7 },
        { title: 'Debrief with Cielo/Nick on what worked',                  offset_days:  7 },
        { title: 'Team feedback',                                           offset_days: 14 },
      ],
    },
  ],
};

async function main() {
  const res = await fetch(`${BASE}/api/goals`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PW}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ op: 'upsertTemplate', ...template }),
  });
  if (!res.ok) {
    console.error(`upsertTemplate failed: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }
  const result = await res.json();
  console.log(`Seeded template "${result.name}" (id=${result.id})`);
  console.log(`${template.sections.length} sections, ${template.sections.reduce((a, s) => a + s.tasks.length, 0)} tasks`);
}

main().catch(e => { console.error(e); process.exit(1); });
