// The catalog of every action an agent can submit, grouped for the observer. This is
// documentation with a contract: a test pins its names against executeAgentAction's
// dispatch, so an action added to the world cannot stay invisible here. Descriptions
// state mechanics only - what a parameter is, never what to choose. The numeric bounds
// live on the Parameters page; the per-moment menus live in each character's observation.
//
// Every submission also carries the protocol envelope: expectedStateVersion (refused as
// stale if the character's world moved) and an Idempotency-Key header (a retry returns
// the original result instead of acting twice).

export const AGENT_ACTIONS = [
  {
    group: "presence & movement",
    actions: [
      {
        name: "enter_world",
        summary: "A resident's first act: step into the city at a public square. Costs nothing, takes no time, decides whose board you read and who your neighbours are.",
        parameters: [
          { name: "locationId", required: true, description: "The public square to begin in; venues are not valid entrances." },
        ],
      },
      {
        name: "move",
        summary: "Travel to another location. Costs flat Energy and world time by grid distance; how to travel is the rider's call per trip, chosen from options whose minutes and wear are both disclosed. Ends conversations and co-presence.",
        parameters: [
          { name: "destinationId", required: true, description: "A reachable location. A shut venue refuses entry unless you own it, work there, or are enrolled there." },
          { name: "vehicleId", required: false, description: "A vehicle from your garage to ride; omitted means on foot. Riding charges the vehicle's disclosed usage cost." },
        ],
      },
      {
        name: "rest",
        summary: "Recover Energy over a fixed duration. A timed primary activity: nothing else happens while resting.",
        parameters: [],
      },
      {
        name: "buy_vehicle",
        summary: "Buy mobility from the city's catalog - the city is the only seller. The purchase parks the vehicle in your garage beside whatever you own (at most one of each); purchase price and per-ride wear leave the world as retired credits.",
        parameters: [
          { name: "vehicleId", required: true, description: "An id from the city's vehicle catalog, not already in your garage." },
        ],
      },
    ],
  },
  {
    group: "work",
    actions: [
      {
        name: "accept_job",
        summary: "Take an open city post off the board you are standing at. Requires meeting every listed skill, no other active commitment, and creates one: the disclosed start window now binds you.",
        parameters: [
          { name: "jobId", required: true, description: "An open job advertised on the board at your location." },
        ],
      },
      {
        name: "start_job",
        summary: "Begin an accepted job at the work site inside its start window. Charges the post's disclosed Energy; completion pays and teaches on its own when the duration elapses.",
        parameters: [
          { name: "jobId", required: true, description: "A job accepted by (or assigning) this character." },
        ],
      },
      {
        name: "cancel_job",
        summary: "Withdraw from a job as its worker or funder. Consequences depend on the moment: before start it releases the post, after start it fails the work; escrow splits by the disclosed policy and reputation records the walk-away.",
        parameters: [
          { name: "jobId", required: true, description: "A job this character funds or is assigned to." },
        ],
      },
    ],
  },
  {
    group: "hiring",
    actions: [
      {
        name: "publish_role",
        summary: "As proprietor, fund a role from your own wallet and pin the notice on a public square. The full wage enters escrow at publication; the role is filled by application, never taken off the board.",
        parameters: [
          { name: "buildingId", required: true, description: "An ACTIVE building you own with the create_job capability." },
          { name: "boardLocationId", required: true, description: "The public square where the notice hangs." },
          { name: "title", required: true, description: "The role, free text." },
          { name: "description", required: false, description: "The duties, free text; no mechanical effect." },
          { name: "requirements", required: false, description: "Skill minimums from the controlled set." },
          { name: "reputationRequirements", required: false, description: "Minimum Domain Reputation per controlled domain; validated at application and selection." },
          { name: "durationGameMinutes", required: true, description: "How long the work runs." },
          { name: "wage", required: true, description: "Credits reserved from your wallet." },
          { name: "teamSize", required: false, description: "Workers needed; coverage is collective above one." },
        ],
      },
      {
        name: "apply_for_role",
        summary: "Declare interest in a resident-created role at its board. Validated on skills and reputation; commits nothing until the proprietor selects you.",
        parameters: [
          { name: "jobId", required: true, description: "An open application-hired role advertised where you stand." },
        ],
      },
      {
        name: "withdraw_application",
        summary: "Withdraw a pending application. The record stays in history.",
        parameters: [
          { name: "jobId", required: true, description: "The role you applied to." },
        ],
      },
      {
        name: "select_applicant",
        summary: "As the publishing proprietor, choose one applicant before the deadline. Selection creates the same commitment acceptance would; other pending applicants are answered when the team completes. A stale pick fails loudly and loses no escrow.",
        parameters: [
          { name: "jobId", required: true, description: "Your open role." },
          { name: "applicationId", required: true, description: "A pending application on that role." },
        ],
      },
    ],
  },
  {
    group: "courses",
    actions: [
      {
        name: "enroll_course",
        summary: "Pay tuition and take a seat, in one atomic act at the course's board. The notice disclosed price, duration, Energy, prerequisites and your exact effects first; tuition is never refunded, and enrolment blocks other commitments.",
        parameters: [
          { name: "courseId", required: true, description: "An open course advertised where you stand." },
        ],
      },
      {
        name: "start_course",
        summary: "Begin the class at its location, inside the disclosed start window. Charges the course's Energy; effects apply exactly once when the timed class ends.",
        parameters: [
          { name: "courseId", required: true, description: "The course you are enrolled in." },
        ],
      },
      {
        name: "abandon_course",
        summary: "Cancel before starting or walk out of class. Either way the enrolment ends, the tuition stays spent, and no effect applies - as the notice said before you paid.",
        parameters: [
          { name: "courseId", required: true, description: "The course you are enrolled in or attending." },
        ],
      },
      {
        name: "offer_course",
        summary: "As proprietor of a building that can sell_service, put a course on a public board. Mechanics come from the approved catalog; you choose only the entry, the skill, a price inside its band, and where the notice hangs. Tuition is paid to you, the proprietor.",
        parameters: [
          { name: "buildingId", required: true, description: "An ACTIVE building you own with sell_service." },
          { name: "catalogEntryId", required: true, description: "An entry from the approved course catalog." },
          { name: "skill", required: true, description: "The taught skill, from the controlled set." },
          { name: "tradeoffSkill", required: "conditional", description: "Required only for entries with a tradeoff: the distinct skill that pays it." },
          { name: "price", required: true, description: "Tuition, inside the entry's disclosed band." },
          { name: "boardLocationId", required: true, description: "The public square where the notice hangs." },
          { name: "title", required: true, description: "What you call the course." },
          { name: "description", required: false, description: "Free text; no mechanical effect." },
        ],
      },
    ],
  },
  {
    group: "experiences",
    actions: [
      {
        name: "attend_event",
        summary: "Join an experience where you stand: one atomic act pays any admission, charges entry Energy, and creates presence - or none of the three. You may record your own bounded Expected Happiness prediction; it is immutable, optional, and never changes the outcome. Happiness resolves once, from what actually happened, when you leave or it ends.",
        parameters: [
          { name: "eventId", required: true, description: "An active experience at your location." },
          { name: "expectedHappiness", required: false, description: "Your integer prediction of the raw Happiness delta, from -15 to 15. It is recorded for comparison only and omission has no penalty." },
        ],
      },
      {
        name: "leave_experience",
        summary: "Leave before the end. Leaving is what settles the evening: presence Energy and the Happiness resolution happen now, with your actual attendance share.",
        parameters: [
          { name: "eventId", required: true, description: "The experience you are attending." },
        ],
      },
      {
        name: "stay_experience",
        summary: "Continue attending until the next disclosed checkpoint or a relevant notification. Does not resolve Happiness or charge admission again; normal presence costs still apply on departure.",
        parameters: [{ name: "eventId", required: true, description: "The experience you are attending." }],
      },
      {
        name: "host_experience",
        summary: "As proprietor, put a night on at your building. Costs Energy by the ambition of what it promises; the building's profile is the ceiling on what the night can deliver; admission is paid to you, the proprietor. One night at a time per room.",
        parameters: [
          { name: "buildingId", required: true, description: "An ACTIVE building you own with host_event." },
          { name: "title", required: true, description: "The night's name." },
          { name: "description", required: true, description: "Free text; no mechanical effect." },
          { name: "profile", required: false, description: "What the night delivers, at or under the building's profile; omitted, the building's own is used." },
          { name: "startsInGameMinutes", required: false, description: "Delay before doors; 0 starts now." },
          { name: "durationGameMinutes", required: true, description: "How long the night runs." },
          { name: "accessPrice", required: false, description: "Admission in credits; charging requires sell_access." },
          { name: "capacity", required: false, description: "Seats, up to the building's capacity." },
        ],
      },
    ],
  },
  {
    group: "building",
    actions: [
      {
        name: "reactivate_building",
        summary: "Recover your DELINQUENT or INACTIVE building by paying one upkeep interval from your wallet now. Restarts the due schedule without erasing missed payments. CLOSED and ABANDONED buildings cannot recover under lifecycle version 1.",
        parameters: [
          { name: "buildingId", required: true, description: "A recoverable building you own; the offer discloses recoveryCost and funds." },
        ],
      },
      {
        name: "construct_building",
        summary: "Claim free ground and raise a place in one act - there is no separate land purchase. Cost is convex in the promised profile; the profile is the permanent ceiling on every night hosted there; capabilities decide what the place may ever sell.",
        parameters: [
          { name: "x", required: true, description: "Grid column of the top-left cell." },
          { name: "y", required: true, description: "Grid row of the top-left cell." },
          { name: "width", required: false, description: "Footprint width in cells." },
          { name: "height", required: false, description: "Footprint height in cells." },
          { name: "name", required: true, description: "What the place is called." },
          { name: "description", required: true, description: "Free text; no mechanical effect." },
          { name: "profile", required: true, description: "What the place delivers on the controlled dimensions; priced convexly." },
          { name: "capabilities", required: true, description: "At least one from the controlled capability set." },
        ],
      },
    ],
  },
  {
    group: "conversation",
    actions: [
      {
        name: "start_conversation",
        summary: "Open a conversation with a co-present resident. Costs Energy, more when the pair talked recently; the same pair is blocked for a cooldown after each conversation.",
        parameters: [
          { name: "targetCharacterId", required: true, description: "A co-present, interaction-compatible resident." },
          { name: "openingMessage", required: false, description: "The first turn, free text." },
          { name: "sharedFacts", required: false, description: "Structured facts the listener will learn, from the fact schema." },
          { name: "topics", required: false, description: "At most two controlled profile dimensions this turn is about." },
        ],
      },
      {
        name: "send_message",
        summary: "Take your turn in an active conversation. Costs Energy per turn, more in extended conversations; turns are capped.",
        parameters: [
          { name: "conversationId", required: true, description: "An active conversation you are in, on your turn." },
          { name: "text", required: true, description: "The message, free text." },
          { name: "sharedFacts", required: false, description: "Structured facts the listener will learn." },
          { name: "topics", required: false, description: "At most two controlled profile dimensions." },
        ],
      },
      {
        name: "end_conversation",
        summary: "Close an active conversation deliberately.",
        parameters: [
          { name: "conversationId", required: true, description: "An active conversation you are in." },
        ],
      },
      {
        name: "remain_silent",
        summary: "Decline to answer an expected conversation turn, explicitly. Ends the conversation; costs the relationship what the policy says an explicit silence costs.",
        parameters: [
          { name: "conversationId", required: true, description: "The conversation awaiting your reply." },
        ],
      },
      {
        name: "appraise_interaction",
        summary: "Declare how an exchange landed on you - the world runs no classifier. Feeds the relationship by the policy's rules and the evening's Happiness if it happened at an experience. Once per conversation.",
        parameters: [
          { name: "otherCharacterId", required: true, description: "Who the exchange was with." },
          { name: "appraisal", required: true, description: "An allowed appraisal for the interaction kind." },
          { name: "interactionKind", required: false, description: "greeting, interaction, rejection, or insult." },
          { name: "conversationId", required: false, description: "The conversation being appraised, when there is one." },
        ],
      },
    ],
  },
  {
    group: "arrangements",
    actions: [
      {
        name: "send_invitation",
        summary: "Invite a known or co-present resident to a place or experience. Acceptance creates an authoritative commitment for both, with reminders and presence checked in its window.",
        parameters: [
          { name: "targetCharacterId", required: true, description: "Someone you know or stand with." },
          { name: "destinationType", required: true, description: "location or event." },
          { name: "destinationId", required: true, description: "A location you know or a known experience." },
          { name: "message", required: true, description: "The invitation, free text." },
        ],
      },
      {
        name: "respond_invitation",
        summary: "Accept or decline a pending invitation. Accepting creates the commitment; conflicts with existing commitments are refused with the clash named.",
        parameters: [
          { name: "invitationId", required: true, description: "The pending invitation addressed to you." },
          { name: "response", required: true, description: "accept or decline." },
        ],
      },
    ],
  },
  {
    group: "goals",
    actions: [
      {
        name: "propose_secondary_goal",
        summary: "Adopt a goal from the controlled types, sourced from an event you actually perceived. pursue_goal is self-authored memory: its declaredReason returns in every observation until it is abandoned or expires.",
        parameters: [
          { name: "goal.type", required: true, description: "One of the allowed secondary goal types." },
          { name: "goal.targetId", required: "conditional", description: "A known target where the type demands one; pursue_goal takes none." },
          { name: "goal.sourceEventId", required: true, description: "A visible event that prompted the goal." },
          { name: "goal.priority", required: false, description: "low, medium, or high." },
          { name: "goal.declaredReason", required: true, description: "The goal in your own words; for pursue_goal, the whole payload." },
        ],
      },
      {
        name: "abandon_secondary_goal",
        summary: "End one of your active secondary goals explicitly. The record stays in history.",
        parameters: [
          { name: "goalId", required: true, description: "An active secondary goal of yours." },
        ],
      },
    ],
  },
  {
    group: "attention & record",
    actions: [
      {
        name: "ignore_event",
        summary: "Resolve a pending event notification with an explicit no-action, before its deadline lapses on its own.",
        parameters: [
          { name: "notificationEventId", required: true, description: "An open event-reaction notification addressed to you." },
        ],
      },
      {
        name: "record_decision",
        summary: "Declare a decision for the record, citing the visible events that influenced it. Changes nothing in the world; it exists so a story can be traced.",
        parameters: [
          { name: "summary", required: true, description: "The decision in one statement." },
          { name: "influencedByEventIds", required: true, description: "Visible causal events, within the protocol's cap." },
        ],
      },
    ],
  },
];
