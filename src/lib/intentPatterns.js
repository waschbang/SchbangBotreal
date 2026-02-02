// Intent pattern matching system
const intentPatterns = {
  companyInfo: {
    keywords: [
      "founder",
      "history",
      "awards",
      "location",
      "office",
      "about schbang",
      "what is schbang",
      "who is schbang",
      "clients",
      "partner with",
      "partnership",
      "job",
      "career",
      "campaign",
      "harshil",
      "karia",
      "ceo",
      "leadership",
      "when was schbang",
      "started",
      "established",
      "company",
      "organization",
      "agency",
      "tell me about",
      "what does schbang",
      "achievements",
      "tell me more",
      "know more",
      "want to know",
      "interested in knowing",
      "can you explain",
      "what exactly",
      "mission",
      "vision",
      "values",
      "culture",
      "story",
      "journey",
      "background",
      "experience",
      "expertise",
      "specialization",
      "focus areas",
      "industries",
      "sectors",
      "markets",
      "presence",
      "global",
      "international",
      "india",
      "mumbai",
      "bangalore",
      "delhi",
    ],
    phrases: [
      "tell me about schbang",
      "who started schbang",
      "when did schbang start",
      "schbang history",
      "about the company",
      "company information",
      "who are your clients",
      "client list",
      "where are you located",
      "office locations",
      "how big is schbang",
      "company size",
      "awards won",
      "recognition",
      "leadership team",
      "management team",
      "what's the story behind schbang",
      "how did schbang begin",
      "tell me more about the company",
      "what makes schbang different",
      "what's special about schbang",
      "why choose schbang",
      "what's your mission",
      "company values",
      "schbang culture",
      "how many employees",
      "team size",
      "global presence",
      "international offices",
      "which countries",
      "where all do you operate",
    ],
  },

  services: {
    keywords: [
      "service",
      "offer",
      "provide",
      "solution",
      "capability",
      "expertise",
      "specialization",
      "digital",
      "marketing",
      "advertising",
      "branding",
      "media",
      "technology",
      "development",
      "consulting",
      "strategy",
      "creative",
      "design",
      "content",
      "social media",
      "help me with",
      "need help",
      "looking for",
      "interested in",
      "want to know about",
      "tell me about",
      "explain",
      "what kind of",
      "type of",
      "categories",
      "packages",
      "pricing",
      "cost",
      "rates",
      "fees",
      "budget",
      "investment",
      "roi",
      "results",
      "case studies",
      "success stories",
      "portfolio",
      "examples",
    ],
    phrases: [
      "what services",
      "services offered",
      "what do you offer",
      "what does schbang do",
      "how can you help",
      "what can you do",
      "tell me about your services",
      "service offerings",
      "list of services",
      "types of services",
      "how much do services cost",
      "what are your rates",
      "pricing information",
      "service packages",
      "what's included",
      "how does it work",
      "process overview",
      "how do you work",
      "what's your approach",
      "methodology",
      "can you help with",
      "do you handle",
      "do you work on",
      "expertise in",
      "specialized in",
      "best at",
      "known for",
    ],
    excludeIfIncludes: [
      "my services",
      "our services",
      "current services",
      "subscribed services",
    ],
  },

  subscribedServices: {
    keywords: [
      "my service",
      "our service",
      "current service",
      "subscribed service",
      "taking",
      "subscription",
    ],
    phrases: [
      "what services am i",
      "what services are we",
      "our current services",
      "services we have",
      "what am i subscribed to",
      "what services do we take",
      "services we are taking",
    ],
  },

  work: {
    keywords: [
      "work",
      "portfolio",
      "deck",
      "showcase",
      "case study",
      "case studies",
      "projects",
      "campaigns",
      "examples",
    ],
    phrases: [
      "show me your work",
      "latest projects",
      "project deck",
      "work examples",
      "case studies",
      "portfolio showcase",
      "recent work",
      "work done",
      "project examples",
    ],
    excludeIfIncludes: ["post", "reel", "instagram", "youtube", "social media"],
  },

  training: {
    keywords: [
      "training",
      "academy",
      "learn",
      "course",
      "workshop",
      "program",
      "education",
      "skill",
      "development",
      "certification",
      "class",
    ],
    phrases: [
      "training programs",
      "learning opportunities",
      "skill development",
      "academy details",
      "training details",
      "education programs",
      "courses offered",
      "workshop schedule",
    ],
  },

  csatInfo: {
    keywords: ["csat", "satisfaction", "survey", "rating", "feedback form"],
    phrases: [
      "what is csat",
      "about csat",
      "csat information",
      "how does csat work",
      "satisfaction survey info",
      "explain csat",
    ],
    excludeIfIncludes: ["fill", "submit", "want to", "email", "mail"],
  },

  fillCsat: {
    keywords: [
      "csat",
      "CSAT",
      "Csat",
      "CSat",
      "satisfaction",
      "survey",
      "rating",
      "c sat",
      "c sat form",
      "customer satisfaction",
      "survey",
    ],
    requiredKeywords: ["fill", "submit", "want", "give", "provide"],
    phrases: [
      "fill csat",
      "fill CSAT",
      "fill Csat",
      "submit csat",
      "submit CSAT",
      "want to fill csat",
      "want to fill CSAT",
      "give rating",
      "provide feedback",
      "fill satisfaction survey",
      "submit survey",
    ],
    excludeIfIncludes: ["email", "mail"],
  },

  csatEmail: {
    keywords: ["csat", "CSAT", "Csat", "CSat", "satisfaction", "survey"],
    requiredKeywords: ["email", "mail", "send", "mail"],
    phrases: [
      "send csat to email",
      "send CSAT to email",
      "email me the csat",
      "email me the CSAT",
      "mail the survey",
      "send satisfaction survey to mail",
      "email the feedback form",
      "send me csat on email",
      "send me CSAT on email",
    ],
  },

  feedback: {
    keywords: ["feedback", "suggestion", "review", "input", "opinion"],
    phrases: [
      "give feedback",
      "provide feedback",
      "share feedback",
      "feedback form",
      "submit feedback",
    ],
    excludeIfIncludes: ["csat", "satisfaction survey"],
  },

  greeting: {
    keywords: [
      "hi",
      "hello",
      "hey",
      "good morning",
      "good afternoon",
      "good evening",
      "greetings",
    ],
    phrases: ["hi there", "hello there", "hey there", "greetings", "good day"],
    maxLength: 20, // Only consider as greeting if message is short
  },

  negativeSentiment: {
    keywords: [
      "bad",
      "poor",
      "terrible",
      "awful",
      "horrible",
      "worst",
      "useless",
      "waste",
      "disappointed",
      "unhappy",
      "angry",
      "upset",
      "frustrated",
      "not good",
      "not working",
      "problem",
      "issue",
      "complaint",
      "dissatisfied",
      "unacceptable",
      "destroy",
      "suck",
      "sucks",
      "stupid",
      "hate",
      "trash",
      "garbage",
      "rubbish",
      "pathetic",
      "incompetent",
      "fail",
      "failed",
      "failure",
      "mess",
      "messed up",
      "screwed up",
      "crap",
      "bs",
      "nonsense",
      "joke",
      "ridiculous",
      "wtf",
      "wth",
      "hell",
      "damn",
      "shit",
      "fuck",
      "fucking",
      "idiot",
      "dumb",
      "stupid",
      "worthless",
      "lousy",
      "hopeless",
      "disgrace",
      "disgraceful",
      "disgusting",
      "annoying",
      "annoyed",
      "irritating",
      "irritated",
      "furious",
      "mad",
      "pissed",
      "sick of",
      "tired of",
      "fed up",
      "done with",
      "give up",
      "giving up",
    ],
    phrases: [
      "not satisfied",
      "very poor",
      "this is bad",
      "not happy",
      "needs improvement",
      "fix this",
      "this is wrong",
      "not acceptable",
      "very disappointed",
      "waste of time",
      "not working properly",
      "you guys suck",
      "this sucks",
      "what the hell",
      "what the fuck",
      "are you kidding",
      "you must be joking",
      "can't believe this",
      "this is ridiculous",
      "this is unacceptable",
      "worst service",
      "worst experience",
      "terrible service",
      "terrible experience",
      "completely useless",
      "total waste",
      "absolute garbage",
      "makes no sense",
      "don't understand",
      "do not understand",
      "getting frustrated",
      "losing patience",
      "had enough",
      "that's it",
      "i quit",
      "i'm done",
      "forget it",
      "never mind",
      "don't bother",
      "do not bother",
    ],
    shouldMatchPartialWords: true,
  },

  contactRequest: {
    keywords: [
      "contact",
      "reach",
      "connect",
      "get in touch",
      "phone",
      "email",
      "number",
    ],
    phrases: [
      "contact information",
      "how to contact",
      "contact details",
      "get in touch",
      "reach out",
      "contact number",
      "email address",
    ],
  },

  shortResponse: {
    keywords: [
      "yes",
      "no",
      "ok",
      "okay",
      "sure",
      "fine",
      "alright",
      "thanks",
      "thank you",
    ],
    maxLength: 15, // Only consider as short response if message is brief
  },

  team: {
    keywords: [
      "team",
      "who",
      "members",
      "people",
      "staff",
      "employees",
      "enabler",
    ],
    requiredContext: [
      "working",
      "work",
      "brand",
      "account",
      "project",
      "handle",
    ],
    phrases: [
      "who is working",
      "team members",
      "who handles",
      "who is handling",
      "my team",
      "brand team",
      "account team",
      "project team",
      "who is my enabler",
    ],
  },

  brief: {
    keywords: ["brief", "new client", "submit", "fill"],
    phrases: [
      "submit brief",
      "fill brief",
      "send brief",
      "new client brief",
      "brief submission",
      "how to submit brief",
      "want to submit brief",
    ],
  },

  humanRequest: {
    keywords: ["human", "person", "team", "someone", "staff"],
    requiredKeywords: ["talk", "speak", "connect", "chat"],
    phrases: [
      "talk to team",
      "connect with human",
      "speak with team",
      "talk to schbang team",
      "connect with team schbang",
      "speak with someone",
      "talk to human",
      "connect with person",
      "speak to someone",
      "chat with human",
    ],
  },

  socialMedia: {
    keywords: [
      "social",
      "media",
      "instagram",
      "facebook",
      "linkedin",
      "twitter",
      "youtube",
      "reel",
      "post",
      "content",
      "video",
      "follow",
      "handle",
      "profile",
      "page",
      "account",
      "latest",
      "recent",
      "update",
      "share",
      "link",
    ],
    phrases: [
      "social media presence",
      "instagram handle",
      "facebook page",
      "linkedin profile",
      "youtube channel",
      "latest posts",
      "recent content",
      "show me your reels",
      "social media links",
      "latest updates",
      "recent work",
      "showcase",
      "portfolio",
    ],
  },

  reels: {
    keywords: [
      "reel",
      "reels",
      "show reel",
      "showreel",
      "instagram reel",
      "instagram reels",
      "insta",
    ],
    phrases: [
      "show me your reels",
      "show reels",
      "can i see your reels",
      "share your reels",
      "send reels",
    ],
    // Adding required keywords to make matching more strict
    requiredKeywords: [
      "reel",
      "reels",
      "instagram reel",
      "instagram reels",
      "insta",
    ],
  },

  agencyReel: {
    keywords: ["2025 reel", "agency reel", "showreel", "schbang reel"],
    phrases: [
      "agency reel",
      "2025 agency reel",
      "schbang agency reel",
      "show me the agency reel",
      "latest agency reel",
      "2025 agency reel",
      "schbang reel 2025",
    ],
    requiredKeywords: ["reel", "agency reel", "2025"],
  },

  casual: {
    keywords: [
      "how are you",
      "what's up",
      "wassup",
      "how's it going",
      "nice",
      "great",
      "awesome",
      "amazing",
      "cool",
      "good",
      "wonderful",
      "excellent",
      "perfect",
      "thanks",
      "thank you",
      "appreciate",
      "helpful",
      "understood",
      "got it",
      "i see",
      "interesting",
    ],
    maxLength: 30,
    phrases: [
      "how are you doing",
      "how's everything",
      "that's great",
      "sounds good",
      "makes sense",
      "i understand",
      "thanks for helping",
      "appreciate your help",
      "you're helpful",
      "that's helpful",
      "good to know",
      "interesting stuff",
    ],
  },
};

// Helper function to check if text matches any pattern
function matchesPattern(text, pattern) {
  const normalizedText = text.toLowerCase();

  // Check for exclusions first
  if (pattern.excludeIfIncludes) {
    for (const exclude of pattern.excludeIfIncludes) {
      if (normalizedText.includes(exclude.toLowerCase())) {
        return false;
      }
    }
  }

  // Check max length constraint if specified
  if (pattern.maxLength && text.length > pattern.maxLength) {
    return false;
  }

  // Check for exact phrases first (higher priority)
  if (pattern.phrases) {
    for (const phrase of pattern.phrases) {
      if (normalizedText.includes(phrase.toLowerCase())) {
        return true;
      }
    }
  }

  // Check for required keyword combinations
  if (pattern.requiredKeywords) {
    const hasRequiredKeyword = pattern.requiredKeywords.some((keyword) =>
      normalizedText.includes(keyword.toLowerCase())
    );
    if (!hasRequiredKeyword) {
      return false;
    }
  }

  // Check for required context if specified
  if (pattern.requiredContext) {
    const hasRequiredContext = pattern.requiredContext.some((context) =>
      normalizedText.includes(context.toLowerCase())
    );
    if (!hasRequiredContext) {
      return false;
    }
  }

  // Check for keywords (lower priority than phrases)
  if (pattern.keywords) {
    const words = normalizedText.split(/\s+/);
    return pattern.keywords.some((keyword) => {
      const keywordParts = keyword.toLowerCase().split(/\s+/);
      return keywordParts.every((part) => words.includes(part));
    });
  }

  return false;
}

// Main function to classify message intent
async function classifyMessageIntent(message, previousMessages = []) {
  const result = {
    isCompanyInfo: matchesPattern(message, intentPatterns.companyInfo),
    isAskingAboutServices: matchesPattern(message, intentPatterns.services),
    isAskingAboutSubscribedServices: matchesPattern(
      message,
      intentPatterns.subscribedServices
    ),
    isAskingAboutWork: matchesPattern(message, intentPatterns.work),
    isAskingAboutTraining: matchesPattern(message, intentPatterns.training),
    isRequestingCSATInfo: matchesPattern(message, intentPatterns.csatInfo),
    isRequestingToFillCSAT: matchesPattern(message, intentPatterns.fillCsat),
    isRequestingCSATViaEmail: matchesPattern(message, intentPatterns.csatEmail),
    isRequestingFeedback: matchesPattern(message, intentPatterns.feedback),
    isGreeting: matchesPattern(message, intentPatterns.greeting),
    isNegativeSentiment: matchesPattern(
      message,
      intentPatterns.negativeSentiment
    ),
    isContactRequest: matchesPattern(message, intentPatterns.contactRequest),
    isRepetitive: previousMessages.includes(message),
    isAskingAboutName: message.toLowerCase().includes("name"),
    isAskingHuman: matchesPattern(message, intentPatterns.humanRequest),
    isShortResponse: matchesPattern(message, intentPatterns.shortResponse),
    isAskingAboutTeam: matchesPattern(message, intentPatterns.team),
    isAskingToFillBrief: matchesPattern(message, intentPatterns.brief),
    isAskingAboutSocialMedia: matchesPattern(
      message,
      intentPatterns.socialMedia
    ),
    isAskingAboutReels: matchesPattern(message, intentPatterns.reels),
    isAskingAboutAgencyReel: matchesPattern(message, intentPatterns.agencyReel),
    isCasual: matchesPattern(message, intentPatterns.casual),
  };

  return result;
}

module.exports = {
  classifyMessageIntent,
  intentPatterns,
};
