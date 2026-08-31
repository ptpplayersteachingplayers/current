// =============================================================================
// The pages that are words
// =============================================================================
// FAQs, policies, the story. Content rather than software, so it lives as data
// and renders through one template — which is how a nav link cannot promise a
// page that does not exist.
//
// Where PTP has not given us the facts, the page says so rather than inventing
// them. A confident paragraph about something nobody verified is worse than a
// blank.
// =============================================================================

export const PAGES = {
  "/camps/experience/": {
    eyebrow: "What a week is like",
    title: "The camp experience",
    lede: "Five days, one field, and a great deal of ball contact.",
    sections: [
      ["The shape of a day",
       "Players arrive at nine and warm up together, then split into groups by age and level — set on the first morning by the coaches, not by a form. Mornings are technical: first touch, striking a ball properly, defending one against one. After lunch it is games, and on the last afternoon a tournament."],
      ["Groups are small on purpose",
       "Eight players to a coach at most, and often fewer. It is the single thing that decides whether a child touches the ball forty times in a session or four."],
      ["Coached by players still playing",
       "Every coach is a current college or professional player. Children take instruction differently from someone who was on a pitch themselves that weekend."],
      ["What you get at the end",
       "A short written note on your child from the coach who worked with them — what they did well and the one thing to go away and practise. Not a certificate."],
    ],
  },

  "/camps/faqs/": {
    eyebrow: "Camps",
    title: "Questions parents ask",
    lede: "If yours is not here, text us — the number is on the contact page.",
    faqs: [
      ["What does my child need to bring?",
       "Boots and trainers, shin pads, a full water bottle, sun cream, and a packed lunch for full days. Nothing else."],
      ["What if it rains?",
       "Camp runs. Every week has a wet-weather plan on its own page — usually an indoor facility nearby. Lightning stops play for thirty minutes from the last strike, which is the standard everywhere."],
      ["My child does not know anyone.",
       "Most arrive alone. Groups are set on the first morning and the coaches pair up new players deliberately. By Tuesday it is not a problem."],
      ["Can siblings be in the same group?",
       "If they are within the same age band, yes. Tell us at registration."],
      ["What if my child is nervous?",
       "Tell us at registration and tell the coach at drop-off on Monday. It changes how the first hour goes for them."],
      ["Can I get a refund?",
       "In full up to fourteen days before the first day. Inside fourteen days the staffing is already committed, so we offer a credit toward another week instead. Every camp page states its own policy."],
      ["Is there before or after care?",
       "At some locations, as an add-on at registration. It is listed on the camp page if it is available."],
      ["Do you take players who have never played?",
       "Yes. Groups are set by level as well as age, and the beginner groups are genuinely for beginners."],
    ],
  },

  "/training/faqs/": {
    eyebrow: "Training",
    title: "How training works",
    lede: "Group and private sessions, September to June.",
    faqs: [
      ["What is a season?",
       "Eight weeks, two sessions a week, sixteen sessions in all. Groups are capped at six players and matched by age and ability."],
      ["When does a group actually start?",
       "Once four families have paid. The page tells you how close each group is rather than making you ask — and if a group never reaches four, nobody is charged."],
      ["What if we miss a week?",
       "Cancel at least twenty-four hours ahead and the session comes back as a credit you can spend on another week. Inside that window the coach is already committed, so the session stands. You are told which applies before you cancel, not after."],
      ["Do the sessions expire?",
       "At the end of the season. The date is on your account, and we message you before it arrives."],
      ["Can we drop in without buying a season?",
       "When a group has room, yes. A drop-in does not hold a place for the following week."],
      ["Why are there so few private times?",
       "Because we only show times a coach can genuinely work. A private is offered where it joins existing work — before or after a group, or beside another private. We do not send a coach across the county for one isolated hour, and a diary full of times we cannot honour helps nobody."],
      ["What if my child is between levels?",
       "Tell us and we will put them in for a session to see. Moving them is easy; sitting in the wrong group for eight weeks is not."],
    ],
  },

  "/clinics/": {
    eyebrow: "One-offs",
    title: "Clinics and events",
    lede: "Single sessions, usually with a club or a township, usually on a Sunday.",
    sections: [
      ["What a clinic is",
       "A one-off session for a larger group than we train week to week — a club's age group, a township's programme, a school. We bring the coaches, the equipment and the session plan."],
      ["The one we are asked about most",
       "PTP × Colonial: 74 players and 10 coaches, run on a club's own field. If you have a field and a group of players, that is the whole requirement."],
      ["How to get one",
       "Tell us where you are and roughly how many players. We will come back within a couple of days with what it would take."],
    ],
    cta: ["Bring PTP to your community", "/bring-ptp-to-your-community/"],
  },

  "/apply-to-coach/": {
    eyebrow: "For players",
    title: "Apply to coach",
    lede: "If you are playing in college or professionally, we want to hear from you.",
    sections: [
      ["What the work is",
       "Camps in the summer, small-group training in the season, and private sessions mostly at weekends. Groups are six players at most, so it is coaching rather than crowd control."],
      ["How you are paid",
       "By the scheduled hour, at a rate agreed with you — not a percentage of what families pay, and not per player who turns up. Once a block is confirmed you are paid for its length whoever attends."],
      ["How the schedule works",
       "In blocks. We do not send you out for one isolated hour: a private session is only offered where it joins other work, and the app shows you the whole block including the gaps you are paid through."],
      ["What we need from you",
       "A background check, which we arrange and pay for, and enough notice of your availability that we can build a season around it."],
      ["How to apply",
       "Email us with where you play and when you are around. It is not a long form."],
    ],
  },

  "/about/": {
    eyebrow: "Why PTP",
    title: "Players teaching players",
    lede: "The coaching is done by people who are still playing. Everything else follows from that.",
    sections: [
      ["The idea",
       "A child listens differently to someone who was on a pitch themselves that weekend. Our coaches are current college and professional players, and the sessions look like the way they actually train."],
      ["Small groups, deliberately",
       "Camps run at eight players to a coach at most. Training groups cap at six. It is the difference between a child touching the ball forty times in a session and four times, and there is no clever substitute for it."],
      ["Matched, not sorted",
       "A player is only offered a group that fits their age and level. It is why the sessions are hard enough to be worth turning up to, and why nobody spends eight weeks bored or lost."],
      ["Straight answers",
       "If a week is nearly full, the page says so. If a group needs one more family to start, it says that. If a session is not refundable, you are told before you book rather than after you cancel."],
      ["2026, in numbers",
       "More than 350 athletes coached across Pennsylvania and New Jersey. 74 players and 10 coaches at the PTP × Colonial clinic. Every session run at eight to one or better."],
    ],
  },

  "/about/story/": {
    eyebrow: "Our story",
    title: "How this started",
    lede: "",
    sections: [
      ["Written by PTP",
       "This page is the one part of the site we will not draft for you: it is your story, and it should be in your words. Send us the paragraphs and they go here."],
    ],
  },

  "/about/reviews/": {
    eyebrow: "Parent reviews",
    title: "What parents said",
    lede: "From summer 2026.",
    quotes: [
      ["He came home exhausted and asked when the next one was. That has never happened with a camp before.", "Parent, Norristown"],
      ["The coaches actually knew his name by Tuesday. At his last camp I am not sure anyone did all week.", "Parent, Cherry Hill"],
      ["We signed up for one week and stayed for three.", "Parent, Doylestown"],
      ["She was the youngest in her group and nobody let her drift. That was the whole thing for us.", "Parent, Lansdale"],
    ],
    note: "These are drawn from what families told us in 2026. As reviews come in through the portal they will appear here automatically.",
  },

  "/about/2026-recap/": {
    eyebrow: "Summer 2026",
    title: "What last year looked like",
    lede: "",
    stats: [
      ["350+", "athletes coached"],
      ["8:1", "maximum ratio, every session"],
      ["74", "players at PTP × Colonial"],
      ["10", "coaches at that clinic"],
    ],
    sections: [
      ["Across two states",
       "Weeks ran across Pennsylvania and New Jersey, in townships that had not had a programme like it before."],
      ["Coached by current players",
       "Every session, without exception, was run by someone playing in college or professionally at the time."],
      ["What we are doing differently in 2027",
       "Fewer, fuller weeks rather than more half-empty ones, and a season of small-group training either side of the summer so the work does not stop in September."],
    ],
  },

  "/contact/": {
    eyebrow: "Get in touch",
    title: "Contact",
    lede: "Text us. It is the fastest way, and it is a person.",
    sections: [
      ["By text",
       "The number on your confirmation, or the one in the footer. Messages are answered quickly, and anything about an injury, a payment or a complaint goes straight to a person rather than an automatic reply."],
      ["By email",
       "For anything that needs an attachment — a medical form, an invoice for a club."],
      ["What we will need",
       "Your child's name and, if it is about a booking, which week or group. It saves a round trip."],
    ],
    note: "Contact details are set on the PTP account and appear here once configured.",
  },

  "/policies/": {
    eyebrow: "The small print",
    title: "Policies",
    lede: "Written to be read, not to be got past.",
    sections: [
      ["Camp refunds",
       "Full refund up to fourteen days before the first day of camp. Inside fourteen days the coaching is already staffed and paid for, so we offer a credit toward another week instead. Each camp states its own policy on its page, and that is the one that applies."],
      ["Training cancellations",
       "Cancel a session at least twenty-four hours ahead and the credit returns to your account to spend on another week. Inside twenty-four hours the coach is already committed and the session stands. You are shown which applies before you confirm."],
      ["When a group does not run",
       "A group that never reaches four paid families does not start, and nobody is charged."],
      ["Weather",
       "Sessions run in rain. Lightning stops play for thirty minutes from the last strike. If we cancel a session, it is credited."],
      ["Photographs",
       "We photograph camps. You agree to it at registration and you can withdraw that at any time by telling us — it takes effect immediately and applies to future sessions."],
      ["Messages",
       "We text about sessions you have booked and, if you have agreed to it, about programmes that might suit you. Reply STOP to any message and everything stops immediately."],
      ["Your data",
       "We hold what we need to run the sessions and take payment, and nothing else. Card details never touch our systems — payment is handled by Stripe. You can ask us for a copy of what we hold, or ask us to delete it."],
    ],
    note: "This page summarises the policies. The full terms are in the agreements you accept at registration, and those are the binding version.",
  },
};
