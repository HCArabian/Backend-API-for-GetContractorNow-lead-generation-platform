// ============================================
// VALIDATION UTILITIES FOR CONTRACTOR APPLICATION
// File: utils/contractorValidation.js
// ============================================

const validator = require('validator');// Display names for service types

const SERVICE_TYPE_LABELS = {
  'ac_repair': 'AC Repair',
  'ac_installation': 'AC Installation & Replacement',
  'ac_maintenance': 'AC Maintenance & Tune-Up',
  'heating_repair': 'Heating System Repair',
  'furnace_repair': 'Furnace Repair',
  'furnace_installation': 'Furnace Installation & Replacement',
  'hvac_installation': 'Complete HVAC System Installation',
  'emergency_repair': '24/7 Emergency HVAC Repair',
};

const validTypes = [
  // Core AC Services
  'ac_repair',
  'ac_installation',
  'ac_maintenance',
  
  // Core Heating Services  
  'heating_repair',
  'furnace_repair',
  'furnace_installation',
  
  // General HVAC
  'hvac_installation',
  
  // Emergency
  'emergency_repair',
];

// ============================================
// PHONE VALIDATION & FORMATTING
// ============================================

function formatPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function validatePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length !== 10) {
    return { valid: false, error: 'Phone must be 10 digits' };
  }
  
  const areaCode = digits.substring(0, 3);
  if (areaCode === '000' || areaCode === '555' || areaCode[0] === '1' || areaCode[0] === '0') {
    return { valid: false, error: 'Invalid area code' };
  }
  
  // Bot detection
  if (/^(\d)\1{9}$/.test(digits)) {
    return { valid: false, error: 'Invalid phone number' };
  }
  
  if (digits === '1234567890' || digits === '0123456789') {
    return { valid: false, error: 'Invalid phone number' };
  }
  
  // Check for excessive repetition
  const digitCounts = {};
  for (let d of digits) {
    digitCounts[d] = (digitCounts[d] || 0) + 1;
    if (digitCounts[d] > 7) {
      return { valid: false, error: 'Invalid phone number' };
    }
  }
  
  return { valid: true, formatted: formatPhoneNumber(phone) };
}

// ============================================
// EMAIL VALIDATION
// ============================================

function validateEmail(email) {
  if (!validator.isEmail(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  const domain = email.split('@')[1]?.toLowerCase();
  const disposableDomains = [
    'tempmail.com', 'guerrillamail.com', '10minutemail.com',
    'throwaway.email', 'mailinator.com', 'trashmail.com'
  ];
  
  if (disposableDomains.includes(domain)) {
    return { valid: false, error: 'Please use a business email address' };
  }
  
   return { 
    valid: true, 
    normalized: email.toLowerCase().trim() 
  };
}

// ============================================
// GEOGRAPHIC VALIDATION
// ============================================

async function validateGeography(city, state, zipCode) {
  if (!city || !state || !zipCode) {
    return { valid: false, error: 'City, state, and ZIP code are all required' };
  }
  
  // Basic ZIP validation
  if (!/^\d{5}$/.test(zipCode)) {
    return { valid: false, error: 'ZIP code must be 5 digits' };
  }
  
  try {
    // Use free ZIP code API
    const response = await fetch(`https://api.zippopotam.us/us/${zipCode}`);
    
    if (!response.ok) {
      return { valid: false, error: 'Invalid ZIP code' };
    }
    
    const data = await response.json();
    
    if (data.places && data.places.length > 0) {
      const zipState = data.places[0]['state abbreviation'];
      
      // Check state match
      if (zipState.toUpperCase() !== state.toUpperCase()) {
        return { 
          valid: false, 
          error: `ZIP code ${zipCode} is in ${zipState}, not ${state}` 
        };
      }
      
      // Check city match (allow partial matches)
      const zipCities = data.places.map(p => p['place name'].toLowerCase());
      const enteredCity = city.toLowerCase().trim();
      
      const cityMatch = zipCities.some(zipCity => 
        zipCity === enteredCity || 
        zipCity.includes(enteredCity) || 
        enteredCity.includes(zipCity)
      );
      
      if (!cityMatch) {
        const suggestedCity = data.places[0]['place name'];
        return { 
          valid: false, 
          error: `ZIP code ${zipCode} is in ${suggestedCity}, ${zipState}. Did you mean ${suggestedCity}?` 
        };
      }
      
      return { 
        valid: true, 
        normalizedCity: data.places[0]['place name'],
        normalizedState: zipState
      };
    }
    
    return { valid: false, error: 'Could not verify location' };
  } catch (error) {
    console.warn('ZIP validation API failed:', error);
    // If API fails, do basic validation only
    return { valid: true }; // Allow through if API is down
  }
}

// ============================================
// INSURANCE VALIDATION
// ============================================

const knownInsuranceProviders = [
  'State Farm', 'Allstate', 'Progressive', 'GEICO', 'Liberty Mutual',
  'Farmers', 'Nationwide', 'Travelers', 'USAA', 'American Family',
  'The Hartford', 'Chubb', 'Erie Insurance', 'Auto-Owners Insurance',
  'Next Insurance', 'Hiscox', 'Thimble', 'CoverWallet', 'Simply Business',
  'Coterie', 'AP Intego', 'BiBerk', 'Insureon', 'Pie Insurance',
  'Guard Insurance', 'Employers', 'AmTrust', 'Berkshire Hathaway',
  'Zurich', 'AIG', 'Cincinnati Insurance', 'Hanover Insurance'
];

function validateInsurance(insuranceProvider, insurancePolicyNumber, insuranceExpirationDate) {
  const errors = [];
  
  // Provider validation
  if (!insuranceProvider || insuranceProvider.trim().length < 2) {
    errors.push('Insurance provider is required');
  } else {
    // Check if it's a known provider (case insensitive partial match)
    const providerLower = insuranceProvider.toLowerCase();
    const isKnownProvider = knownInsuranceProviders.some(known => 
      providerLower.includes(known.toLowerCase()) || 
      known.toLowerCase().includes(providerLower)
    );
    
    if (!isKnownProvider) {
      console.warn('Unknown insurance provider:', insuranceProvider);
      // Don't reject, just log for manual review
    }
  }
  
  // Policy number validation
  if (!insurancePolicyNumber || insurancePolicyNumber.trim().length < 5) {
    errors.push('Insurance policy number must be at least 5 characters');
  } else {
    // Remove spaces and dashes for validation
    const cleanPolicy = insurancePolicyNumber.replace(/[\s\-]/g, '');
    
    // Check for suspicious patterns
    if (/^(0+|1+|9+|12345|00000)$/.test(cleanPolicy)) {
      errors.push('Invalid insurance policy number format');
    }
    
    // Policy numbers are typically alphanumeric
    if (!/^[A-Z0-9\-\s]+$/i.test(insurancePolicyNumber)) {
      errors.push('Policy number should only contain letters, numbers, and dashes');
    }
  }
  
  // Expiration date validation
  if (!insuranceExpirationDate) {
    errors.push('Insurance expiration date is required');
  } else {
    const expiryDate = new Date(insuranceExpirationDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(expiryDate.getTime())) {
      errors.push('Invalid insurance expiration date');
    } else if (expiryDate < today) {
      errors.push('Insurance policy has expired. Current insurance is required');
    } else if (expiryDate < new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)) {
      // Warning if expiring within 30 days
      console.warn('Insurance expiring soon:', insuranceExpirationDate);
      // Don't reject, but log for follow-up
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}

// ============================================
// LICENSE VALIDATION
// ============================================

function validateLicense(licenseNumber, licenseState, licenseExpirationDate) {
  const errors = [];
  
  if (!licenseNumber || licenseNumber.trim().length < 3) {
    errors.push('License number is required (minimum 3 characters)');
  } else {
    // Check for suspicious patterns
    const cleanLicense = licenseNumber.replace(/[\s\-]/g, '');
    if (/^(0+|1+|12345|00000|test)$/i.test(cleanLicense)) {
      errors.push('Invalid license number format');
    }
  }
  
  if (!licenseState) {
    errors.push('License state is required');
  } else {
    const validStates = [
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
      'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
      'VA','WA','WV','WI','WY','DC'
    ];
    if (!validStates.includes(licenseState.toUpperCase())) {
      errors.push('Invalid license state');
    }
  }
  
  if (licenseExpirationDate) {
    const expiryDate = new Date(licenseExpirationDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(expiryDate.getTime())) {
      errors.push('Invalid license expiration date');
    } else if (expiryDate < today) {
      errors.push('License has expired. Current license is required');
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}

// ============================================
// BUSINESS NAME VALIDATION
// ============================================

function validateBusinessName(businessName) {
  if (!businessName || businessName.trim().length < 3) {
    return { valid: false, error: 'Business name must be at least 3 characters' };
  }
  
  if (businessName.length > 100) {
    return { valid: false, error: 'Business name too long (max 100 characters)' };
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /test/i,
    /fake/i,
    /asdf/i,
    /qwerty/i,
    /^[0-9]+$/,
    /^.{1,2}$/
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(businessName)) {
      console.warn('Suspicious business name detected:', businessName);
      // Log but don't reject - admin will review
    }
  }
  
  return { valid: true };
}

// ============================================
// WEBSITE VALIDATION
// ============================================

function validateWebsite(websiteUrl) {
  if (!websiteUrl) {
    return { valid: true }; // Website is optional
  }
  
  // Add protocol if missing
  let url = websiteUrl;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  
  if (!validator.isURL(url, { require_protocol: true })) {
    return { valid: false, error: 'Invalid website URL format' };
  }
  
  return { valid: true, normalized: url };
}

// ============================================
// TAX ID VALIDATION (EIN)
// ============================================

function validateTaxId(taxId) {
  if (!taxId) {
    return { valid: false, error: 'Tax ID (EIN) is required' };
  }
  
  // Remove dashes and spaces
  const clean = taxId.replace(/[\s\-]/g, '');
  
  // EIN format: XX-XXXXXXX (9 digits)
  if (!/^\d{9}$/.test(clean)) {
    return { valid: false, error: 'Tax ID must be 9 digits (EIN format: XX-XXXXXXX)' };
  }
  
  // Check for invalid patterns
  if (/^(0{9}|1{9}|00\d{7}|07\d{7}|08\d{7}|09\d{7}|17\d{7}|18\d{7}|19\d{7}|28\d{7}|29\d{7}|49\d{7}|69\d{7}|70\d{7}|78\d{7}|79\d{7}|89\d{7})$/.test(clean)) {
    return { valid: false, error: 'Invalid Tax ID format' };
  }
  
  // Format as XX-XXXXXXX
  const formatted = `${clean.slice(0, 2)}-${clean.slice(2)}`;
  
  return { valid: true, formatted };
}

// ============================================
// YEARS IN BUSINESS VALIDATION
// ============================================

function validateYearsInBusiness(years) {
  const yearsNum = parseInt(years);
  
  if (isNaN(yearsNum)) {
    return { valid: false, error: 'Years in business must be a number' };
  }
  
  if (yearsNum < 0) {
    return { valid: false, error: 'Years in business cannot be negative' };
  }
  
  if (yearsNum > 100) {
    return { valid: false, error: 'Years in business seems unusually high' };
  }
  
  return { valid: true };
}

// ============================================
// COMPREHENSIVE CONTRACTOR VALIDATION
// ============================================

async function validateContractorApplication(data) {
  const errors = {};
  
  // Business name
  const businessNameResult = validateBusinessName(data.businessName);
  if (!businessNameResult.valid) {
    errors.businessName = businessNameResult.error;
  }
  
  // Email
  const emailResult = validateEmail(data.email);
  if (!emailResult.valid) {
    errors.email = emailResult.error;
  }
  
  // Phone
  const phoneResult = validatePhone(data.phone);
  if (!phoneResult.valid) {
    errors.phone = phoneResult.error;
  }
  
  // Geography - CRITICAL
  const geoResult = await validateGeography(
    data.businessCity,
    data.businessState,
    data.businessZip
  );
  if (!geoResult.valid) {
    errors.location = geoResult.error;
  }
  
  // Insurance - CRITICAL
  const insuranceResult = validateInsurance(
    data.insuranceProvider,
    data.insurancePolicyNumber,
    data.insuranceExpirationDate
  );
  if (!insuranceResult.valid) {
    errors.insurance = insuranceResult.errors.join('; ');
  }
  
  // License - CRITICAL
  const licenseResult = validateLicense(
    data.licenseNumber,
    data.licenseState,
    data.licenseExpirationDate
  );
  if (!licenseResult.valid) {
    errors.license = licenseResult.errors.join('; ');
  }
  
  // Tax ID
  const taxIdResult = validateTaxId(data.taxId);
  if (!taxIdResult.valid) {
    errors.taxId = taxIdResult.error;
  }
  
  // Years in business
  const yearsResult = validateYearsInBusiness(data.yearsInBusiness);
  if (!yearsResult.valid) {
    errors.yearsInBusiness = yearsResult.error;
  }
  
  // Website (optional)
  if (data.websiteUrl) {
    const websiteResult = validateWebsite(data.websiteUrl);
    if (!websiteResult.valid) {
      errors.websiteUrl = websiteResult.error;
    }
  }
  
  // Service types
  if (!data.specializations || data.specializations.length === 0) {
    errors.specializations = 'At least one service type is required';
  }
  
  // Service ZIP codes
  if (!data.serviceZipCodes || data.serviceZipCodes.length === 0) {
    errors.serviceZipCodes = 'At least one service ZIP code is required';
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalizedData: {
      phone: phoneResult.valid ? phoneResult.formatted : data.phone,
      taxId: taxIdResult.valid ? taxIdResult.formatted : data.taxId,
      websiteUrl: data.websiteUrl ? validateWebsite(data.websiteUrl).normalized : null,
      businessCity: geoResult.valid ? geoResult.normalizedCity : data.businessCity,
      businessState: geoResult.valid ? geoResult.normalizedState : data.businessState,
    }
  };
}

// ============================================
// WRAPPER FUNCTIONS FOR BACKEND COMPATIBILITY
// ============================================

function sanitizeBusinessName(name) {
  if (!name) {
    return { valid: false, error: 'Business name is required' };
  }
  
  const result = validateBusinessName(name);
  if (!result.valid) {
    return result;
  }
  
  // Sanitize: trim and remove special characters
  const sanitized = name.trim().replace(/[<>\"']/g, '');
  
  return {
    valid: true,
    formatted: sanitized
  };
}

function validateAndFormatPhone(phone) {
  return validatePhone(phone);
}

function validateCity(city) {
  if (!city || city.trim().length < 2) {
    return { valid: false, error: 'City name is required' };
  }
  
  // Capitalize first letter of each word
  const formatted = city.trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  return {
    valid: true,
    formatted
  };
}

function validateState(state) {
  if (!state) {
    return { valid: false, error: 'State is required' };
  }
  
  const validStates = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC'
  ];
  
  const stateUpper = state.toUpperCase().trim();
  
  if (!validStates.includes(stateUpper)) {
    return { valid: false, error: 'Invalid state code' };
  }
  
  return {
    valid: true,
    formatted: stateUpper
  };
}

function validateZipCode(zip) {
  if (!zip) {
    return { valid: false, error: 'ZIP code is required' };
  }
  
  const cleanZip = zip.replace(/\D/g, '');
  
  if (cleanZip.length !== 5) {
    return { valid: false, error: 'ZIP code must be 5 digits' };
  }
  
  return {
    valid: true,
    formatted: cleanZip
  };
}

function validateLicenseNumber(licenseNumber, licenseState) {
  const result = validateLicense(licenseNumber, licenseState, null);
  
  if (!result.valid) {
    return { valid: false, error: result.errors.join('; ') };
  }
  
  return {
    valid: true,
    formatted: licenseNumber.trim()
  };
}

function validateAndFormatEIN(taxId) {
  return validateTaxId(taxId);
}

function validateWebsiteUrl(websiteUrl) {
  if (!websiteUrl) {
    return { valid: true, formatted: null };
  }
  
  const result = validateWebsite(websiteUrl);
  
  if (!result.valid) {
    return result;
  }
  
  return {
    valid: true,
    formatted: result.normalized
  };
}

function validateServiceTypes(serviceTypes) {
  if (!serviceTypes || !Array.isArray(serviceTypes)) {
    return { valid: false, error: 'Service types must be an array' };
  }
  
  if (serviceTypes.length === 0) {
    return { valid: false, error: 'At least one service type is required' };
  }
  
  // Validate each service type
  const invalidTypes = serviceTypes.filter(type => !validTypes.includes(type));
  
  if (invalidTypes.length > 0) {
    return {
      valid: false,
      error: `Invalid service types: ${invalidTypes.join(', ')}`
    };
  }
  
  return {
    valid: true,
    formatted: serviceTypes
  };
}

async function validateServiceZipCodes(serviceZipCodes, businessZip) {
  if (!serviceZipCodes || !Array.isArray(serviceZipCodes)) {
    return { valid: false, error: 'Service ZIP codes must be an array' };
  }
  
  if (serviceZipCodes.length === 0) {
    return { valid: false, error: 'At least one service ZIP code is required' };
  }
  
  // Validate each ZIP
  const cleanedZips = [];
  
  for (const zip of serviceZipCodes) {
    const cleanZip = zip.replace(/\D/g, '');
    
    if (cleanZip.length !== 5) {
      return {
        valid: false,
        error: `Invalid ZIP code: ${zip} (must be 5 digits)`
      };
    }
    
    cleanedZips.push(cleanZip);
  }
  
  // Remove duplicates
  const uniqueZips = [...new Set(cleanedZips)];
  
  // Business ZIP should be included
  if (businessZip && !uniqueZips.includes(businessZip)) {
    uniqueZips.push(businessZip);
  }
  
  return {
    valid: true,
    formatted: uniqueZips
  };
}

module.exports = {
  // Main validation function
  validateContractorApplication,
  
  // Individual validators (original names)
  validatePhone,
  validateEmail,
  validateGeography,
  validateInsurance,
  validateLicense,
  validateBusinessName,
  validateTaxId,
  validateWebsite,
  validateYearsInBusiness,
  formatPhoneNumber,
  
  // Backend-compatible wrappers (what index.js actually calls)
  sanitizeBusinessName,
  validateAndFormatPhone,
  validateCity,
  validateState,
  validateZipCode,
  validateLicenseNumber,
  validateAndFormatEIN,
  validateWebsiteUrl,
  validateServiceTypes,
  validateServiceZipCodes,
  
  // Reference data
  knownInsuranceProviders,
  SERVICE_TYPE_LABELS,
  validTypes,
};