// scoring.js - Advanced Lead Scoring & Validation System

// ============================================
// VALIDATION HELPER FUNCTIONS
// ============================================

function validateEmail(email) {
  const issues = [];

  // Format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    issues.push("Invalid email format");
    return { valid: false, issues };
  }

  const domain = email.split("@")[1]?.toLowerCase();

  // Disposable email domains (expanded list)
  const disposableDomains = [
    "tempmail.com",
    "guerrillamail.com",
    "10minutemail.com",
    "throwaway.email",
    "mailinator.com",
    "trashmail.com",
    "temp-mail.org",
    "fakeinbox.com",
    "sharklasers.com",
    "getnada.com",
    "maildrop.cc",
    "yopmail.com",
  ];

  if (disposableDomains.includes(domain)) {
    issues.push("Disposable email not allowed");
    return { valid: false, issues };
  }

  // Check for common typos in popular domains
  const domainCorrections = {
    "gmial.com": "gmail.com",
    "gmai.com": "gmail.com",
    "yahooo.com": "yahoo.com",
    "yaho.com": "yahoo.com",
    "hotmial.com": "hotmail.com",
  };

  if (domainCorrections[domain]) {
    issues.push(`Did you mean ${domainCorrections[domain]}?`);
    return { valid: false, issues };
  }

  return { valid: true, issues: [], domain };
}

function validatePhone(phone) {
  const issues = [];
  const phoneDigits = phone?.replace(/\D/g, "");

  // Length check
  if (!phoneDigits || phoneDigits.length < 10) {
    issues.push("Phone number must be at least 10 digits");
    return { valid: false, issues };
  }

  if (phoneDigits.length > 11) {
    issues.push("Phone number too long");
    return { valid: false, issues };
  }

  // Fake number patterns
  const fakePatterns = [
    /^5555555555$/, // 555-555-5555
    /^1234567890$/, // 123-456-7890
    /^0000000000$/, // 000-000-0000
    /^1111111111$/, // 111-111-1111
    /^(\d)\1{9}$/, // All same digit
  ];

  for (const pattern of fakePatterns) {
    if (pattern.test(phoneDigits)) {
      issues.push("Phone number appears to be fake");
      return { valid: false, issues };
    }
  }

  // Area code validation (first 3 digits can't be 000, 555, or start with 1)
  const areaCode = phoneDigits.substring(0, 3);
  if (areaCode === "000" || areaCode === "555" || areaCode.startsWith("1")) {
    issues.push("Invalid area code");
    return { valid: false, issues };
  }

  return { valid: true, issues: [], phoneDigits, areaCode };
}

function validateZipCode(zip, state) {
  const issues = [];

  // Format check
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    issues.push("ZIP code must be 5 digits (or 5+4 format)");
    return { valid: false, issues };
  }

  const zipDigits = zip.substring(0, 5);

  // State-specific ZIP code ranges (simplified - major ranges only)
  const stateZipRanges = {
    CA: [
      "900",
      "901",
      "902",
      "903",
      "904",
      "905",
      "906",
      "907",
      "908",
      "909",
      "910",
      "911",
      "912",
      "913",
      "914",
      "915",
      "916",
      "917",
      "918",
      "919",
      "920",
      "921",
      "922",
      "923",
      "924",
      "925",
      "926",
      "927",
      "928",
      "930",
      "931",
      "932",
      "933",
      "934",
      "935",
      "936",
      "937",
      "938",
      "939",
      "940",
      "941",
      "942",
      "943",
      "944",
      "945",
      "946",
      "947",
      "948",
      "949",
      "950",
      "951",
      "952",
      "953",
      "954",
      "955",
      "956",
      "957",
      "958",
      "959",
      "960",
      "961",
    ],
    NY: [
      "100",
      "101",
      "102",
      "103",
      "104",
      "105",
      "106",
      "107",
      "108",
      "109",
      "110",
      "111",
      "112",
      "113",
      "114",
      "115",
      "116",
      "117",
      "118",
      "119",
      "120",
      "121",
      "122",
      "123",
      "124",
      "125",
      "126",
      "127",
      "128",
      "129",
      "130",
      "131",
      "132",
      "133",
      "134",
      "135",
      "136",
      "137",
      "138",
      "139",
      "140",
      "141",
      "142",
      "143",
      "144",
      "145",
      "146",
      "147",
      "148",
      "149",
    ],
    TX: [
      "750",
      "751",
      "752",
      "753",
      "754",
      "755",
      "756",
      "757",
      "758",
      "759",
      "760",
      "761",
      "762",
      "763",
      "764",
      "765",
      "766",
      "767",
      "768",
      "769",
      "770",
      "771",
      "772",
      "773",
      "774",
      "775",
      "776",
      "777",
      "778",
      "779",
      "780",
      "781",
      "782",
      "783",
      "784",
      "785",
      "786",
      "787",
      "788",
      "789",
      "790",
      "791",
      "792",
      "793",
      "794",
      "795",
      "796",
      "797",
      "798",
      "799",
      "885",
    ],
    FL: [
      "320",
      "321",
      "322",
      "323",
      "324",
      "325",
      "326",
      "327",
      "328",
      "329",
      "330",
      "331",
      "332",
      "333",
      "334",
      "335",
      "336",
      "337",
      "338",
      "339",
      "340",
      "341",
      "342",
      "343",
      "344",
      "345",
      "346",
      "347",
    ],
  };

  if (state && stateZipRanges[state]) {
    const zipPrefix = zipDigits.substring(0, 3);
    if (!stateZipRanges[state].includes(zipPrefix)) {
      issues.push(`ZIP code ${zipDigits} doesn't match state ${state}`);
      return { valid: false, issues };
    }
  }

  return { valid: true, issues: [], zipDigits };
}

function validateName(name, fieldName) {
  const issues = [];

  if (!name || name.trim().length === 0) {
    issues.push(`${fieldName} is required`);
    return { valid: false, issues };
  }

  // Contains numbers
  if (/\d/.test(name)) {
    issues.push(`${fieldName} cannot contain numbers`);
    return { valid: false, issues };
  }

  // Too short
  if (name.trim().length < 2) {
    issues.push(`${fieldName} must be at least 2 characters`);
    return { valid: false, issues };
  }

  // Too long
  if (name.length > 50) {
    issues.push(`${fieldName} is too long`);
    return { valid: false, issues };
  }

  // Contains too many special characters
  const specialChars = name.replace(/[a-zA-Z\s'-]/g, "");
  if (specialChars.length > 0) {
    issues.push(`${fieldName} contains invalid characters`);
    return { valid: false, issues };
  }

  // Suspicious patterns (keyboard mashing)
  const suspiciousPatterns = [
    /^(asdf|qwer|zxcv|hjkl)/i,
    /^(test|fake|demo)/i,
    /^(.)\1{3,}/, // Same character 4+ times
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(name)) {
      issues.push(`${fieldName} appears invalid`);
      return { valid: false, issues };
    }
  }

  return { valid: true, issues: [] };
}

function validateAddress(address) {
  const issues = [];

  if (!address || address.trim().length < 3) {
    issues.push("Address is required");
    return { valid: false, issues };
  }

  // Check for obviously fake addresses
  const fakePatterns = [/^(asdf|qwer|test.*test)/i, /^(na|n\/a|none)$/i];

  for (const pattern of fakePatterns) {
    if (pattern.test(address.trim())) {
      issues.push("Please enter a valid address");
      return { valid: false, issues };
    }
  }

  // That's it - much more lenient now
  return { valid: true, issues: [] };
}

function validateBudgetPropertyAlignment(budget, propertyType) {
  const issues = [];

  // Unrealistic combinations
  const invalidCombos = [
    {
      budget: "$15,000+",
      property: "Apartment (rent)",
      reason: "Budget too high for rental apartment",
    },
    {
      budget: "Under $500",
      property: "Commercial property",
      reason: "Budget too low for commercial property",
    },
    {
      budget: "$10,000-$14,999",
      property: "Apartment (rent)",
      reason: "Budget unusual for rental apartment",
    },
  ];

  for (const combo of invalidCombos) {
    if (budget === combo.budget && propertyType === combo.property) {
      issues.push(combo.reason);
      return { valid: false, issues };
    }
  }

  return { valid: true, issues: [] };
}

// ============================================
// MAIN SCORING FUNCTION
// ============================================

async function calculateLeadScore(leadData, prisma) {
  const validationErrors = [];
  const qualityFlags = [];
  let score = 0;

  // ============================================
  // PHASE 1: COMPREHENSIVE VALIDATION
  // ============================================

  // 1. Required fields check
  const requiredFields = {
    first_name: "First name",
    last_name: "Last name",
    email: "Email",
    phone: "Phone number",
    address: "Address",
    city: "City",
    state: "State",
    zip: "ZIP code",
    service_type: "Service type",
    timeline: "Timeline",
    budget_range: "Budget range",
    property_type: "Property type",
  };

  for (const [field, label] of Object.entries(requiredFields)) {
    if (!leadData[field] || leadData[field].toString().trim() === "") {
      validationErrors.push(`${label} is required`);
    }
  }

  // If missing required fields, return immediately
  if (validationErrors.length > 0) {
    return {
      status: "rejected",
      score: 0,
      category: "REJECTED",
      price: 0,
      rejectReasons: ["missing_required_fields"],
      validationErrors: validationErrors,
      qualityFlags: [],
    };
  }

  // 2. Name validation
  const firstNameCheck = validateName(leadData.first_name, "First name");
  if (!firstNameCheck.valid) {
    validationErrors.push(...firstNameCheck.issues);
  }

  const lastNameCheck = validateName(leadData.last_name, "Last name");
  if (!lastNameCheck.valid) {
    validationErrors.push(...lastNameCheck.issues);
  }

  // 3. Email validation
  const emailCheck = validateEmail(leadData.email);
  if (!emailCheck.valid) {
    validationErrors.push(...emailCheck.issues);
  } else {
    // Check if work email (bonus points later)
    const freeEmailDomains = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "aol.com",
      "icloud.com",
    ];
    if (!freeEmailDomains.includes(emailCheck.domain)) {
      qualityFlags.push("work_email");
    }
  }

  // 4. Phone validation
  const phoneCheck = validatePhone(leadData.phone);
  if (!phoneCheck.valid) {
    validationErrors.push(...phoneCheck.issues);
  } else {
    // Check if local to property area
    const zipPrefix = leadData.zip?.substring(0, 3);
    // California area codes
    const caAreaCodes = [
      "213",
      "310",
      "323",
      "424",
      "442",
      "510",
      "530",
      "559",
      "562",
      "619",
      "626",
      "628",
      "650",
      "657",
      "661",
      "669",
      "707",
      "714",
      "747",
      "760",
      "805",
      "818",
      "820",
      "831",
      "858",
      "909",
      "916",
      "925",
      "949",
      "951",
    ];
    if (
      caAreaCodes.includes(phoneCheck.areaCode) &&
      zipPrefix?.startsWith("9")
    ) {
      qualityFlags.push("local_phone");
    }
  }

  // 5. Address validation
  const addressCheck = validateAddress(leadData.address);
  // Just check if address exists
  if (!leadData.address || leadData.address.trim().length < 3) {
    validationErrors.push("Address is required");
  }

  // 6. ZIP code validation
  const zipCheck = validateZipCode(leadData.zip, leadData.state);
  if (!zipCheck.valid) {
    validationErrors.push(...zipCheck.issues);
  }

  // 7. Budget/Property alignment check
  const alignmentCheck = validateBudgetPropertyAlignment(
    leadData.budget_range,
    leadData.property_type
  );
  if (!alignmentCheck.valid) {
    validationErrors.push(...alignmentCheck.issues);
  }

  // 8. Form completion time (bot detection)
  if (leadData.form_completion_time && leadData.form_completion_time < 30) {
    validationErrors.push("Form completed too quickly - please slow down");
  }

  // 9. Duplicate check (same email or phone in last 7 days)
  if (prisma) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const duplicateEmail = await prisma.lead.findFirst({
      where: {
        customerEmail: leadData.email,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    const duplicatePhone = await prisma.lead.findFirst({
      where: {
        customerPhone: leadData.phone,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    if (duplicateEmail) {
      validationErrors.push(
        "You already submitted a request with this email in the last 7 days"
      );
    }

    if (duplicatePhone && !duplicateEmail) {
      validationErrors.push(
        "You already submitted a request with this phone number in the last 7 days"
      );
    }
  }

  // 10. IP address validation (if provided)
  if (leadData.ip_address && prisma) {
    // Check for too many submissions from same IP
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ipSubmissions = await prisma.lead.count({
      where: {
        ipAddress: leadData.ip_address,
        createdAt: { gte: today },
      },
    });

    if (ipSubmissions >= 5) {
      validationErrors.push("Too many submissions from your location today");
    }
  }

  // If any validation errors, reject the lead
  if (validationErrors.length > 0) {
    return {
      status: "rejected",
      score: 0,
      category: "REJECTED",
      price: 0,
      rejectReasons: ["validation_failed"],
      validationErrors: validationErrors,
      qualityFlags: [],
    };
  }

  // ============================================
  // PHASE 2: SCORING (0-200 points)
  // ============================================

  // 1. SERVICE TYPE SCORE (0-50 points)
  const serviceScores = {
    "Emergency Repair": 50,
    "System Replacement": 40,
    "HVAC Installation": 35,
    "AC Repair": 30,
    "Heating Repair": 30,
    "Maintenance/Tune-up": 15,
    "Just Getting Quotes": 10,
  };
  score += serviceScores[leadData.service_type] || 0;

  // 2. TIMELINE URGENCY SCORE (0-40 points)
  const timelineScores = {
    "Today/ASAP": 40,
    "Within 1 week": 30,
    "Within 2 weeks": 25,
    "Within 1 month": 20,
    "1-3 months": 10,
    "Just researching": 5,
  };
  score += timelineScores[leadData.timeline] || 0;

  // 3. BUDGET RANGE SCORE (0-40 points)
  const budgetScores = {
    "$15,000+": 40,
    "$10,000-$14,999": 38,
    "$7,000-$9,999": 35,
    "$5,000-$6,999": 32,
    "$3,000-$4,999": 25,
    "$2,000-$2,999": 18,
    "$1,000-$1,999": 12,
    "$500-$999": 6,
    "Under $500": 3,
  };
  score += budgetScores[leadData.budget_range] || 0;

  // 4. PROPERTY TYPE SCORE (0-30 points)
  const propertyScores = {
    "Single-family home (own)": 30,
    "Townhouse (own)": 26,
    "Condo (own)": 24,
    "Multi-family (own)": 22,
    "Commercial property": 20,
    "Apartment (rent)": 8,
  };
  score += propertyScores[leadData.property_type] || 0;

  // 5. CONTACT QUALITY BONUS (0-20 points)
  if (qualityFlags.includes("work_email")) {
    score += 10;
  }
  if (qualityFlags.includes("local_phone")) {
    score += 5;
  }

  // 6. PROPERTY AGE BONUS (0-10 points)
  const propertyAgeScores = {
    "20+ years": 10,
    "10-20 years": 8,
    "5-10 years": 5,
    "0-5 years": 2,
    "Don't know": 0,
  };
  if (leadData.property_age) {
    score += propertyAgeScores[leadData.property_age] || 0;
  }

  // 7. SYSTEM ISSUE URGENCY BONUS (0-15 points)
  const systemIssueScores = {
    "Complete failure": 15,
    "Not cooling properly": 12,
    "Not heating properly": 12,
    Leaking: 10,
    "Strange noises": 8,
    "High energy bills": 5,
    Other: 3,
  };
  if (leadData.system_issue) {
    score += systemIssueScores[leadData.system_issue] || 0;
  }

  // 8. SERVICE DESCRIPTION QUALITY BONUS (0-15 points)
  if (leadData.service_description) {
    const descLength = leadData.service_description.length;
    if (descLength > 100) {
      score += 10;
      qualityFlags.push("detailed_description");
    } else if (descLength > 50) {
      score += 5;
    }

    // Check for urgency keywords
    const urgencyKeywords = [
      "emergency",
      "urgent",
      "asap",
      "immediately",
      "today",
      "now",
      "help",
    ];
    const hasUrgency = urgencyKeywords.some((keyword) =>
      leadData.service_description.toLowerCase().includes(keyword)
    );
    if (hasUrgency) {
      score += 5;
      qualityFlags.push("urgency_keywords");
    }
  }

  // 9. FORM COMPLETION TIME QUALITY (0-5 points)
  if (leadData.form_completion_time) {
    const time = leadData.form_completion_time;
    if (time >= 60 && time <= 300) {
      score += 5;
      qualityFlags.push("thoughtful_completion");
    } else if (time > 300) {
      score += 2; // Took time but maybe got distracted
    }
  }

  // ============================================
  // PHASE 3: CATEGORIZATION & PRICING
  // ============================================

  let category, price;

  if (score >= 140) {
    category = "PLATINUM";
    price = 250;
  } else if (score >= 100) {
    category = "GOLD";
    price = 175;
  } else if (score >= 60) {
    category = "SILVER";
    price = 125;
  } else if (score >= 40) {
    category = "BRONZE";
    price = 85;
  } else {
    category = "NURTURE";
    price = 0;
  }

  // Calculate confidence level (0-100%)
  let confidence = Math.min(Math.floor((score / 200) * 100), 90);

  // Boost confidence for quality signals
  if (qualityFlags.includes("work_email")) confidence += 3;
  if (qualityFlags.includes("detailed_description")) confidence += 3;
  if (qualityFlags.includes("local_phone")) confidence += 2;
  if (qualityFlags.includes("thoughtful_completion")) confidence += 2;

  confidence = Math.min(confidence, 95); // Cap at 95%

  return {
    status: "approved",
    score: score,
    category: category,
    price: price,
    confidenceLevel: confidence,
    qualityFlags: qualityFlags,
    rejectReasons: [],
    validationErrors: [],
  };
}

module.exports = { calculateLeadScore };
