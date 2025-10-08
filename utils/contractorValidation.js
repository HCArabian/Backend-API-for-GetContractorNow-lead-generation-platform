// ============================================
// VALIDATION UTILITIES FOR CONTRACTOR APPLICATION
// File: utils/contractorValidation.js
// ============================================

const validator = require('validator');

// ============================================
// PHONE NUMBER VALIDATION & FORMATTING
// ============================================
function validateAndFormatPhone(phone) {
  if (!phone) {
    return { valid: false, error: 'Phone number is required' };
  }

  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  // Check if it's a valid US phone number (10 digits)
  if (digitsOnly.length !== 10) {
    return { valid: false, error: 'Phone number must be 10 digits (US format)' };
  }

  // Check if area code is valid (doesn't start with 0 or 1)
  const areaCode = digitsOnly.substring(0, 3);
  if (areaCode[0] === '0' || areaCode[0] === '1') {
    return { valid: false, error: 'Invalid area code' };
  }

  // Format as (XXX) XXX-XXXX
  const formatted = `(${digitsOnly.substring(0, 3)}) ${digitsOnly.substring(3, 6)}-${digitsOnly.substring(6)}`;

  return { valid: true, formatted };
}

// ============================================
// EMAIL VALIDATION
// ============================================
function validateEmail(email) {
  if (!email) {
    return { valid: false, error: 'Email is required' };
  }

  // Convert to lowercase
  const normalized = email.toLowerCase().trim();

  // Use validator library for comprehensive email validation
  if (!validator.isEmail(normalized)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // Check for common typos in domains
  const commonTypos = {
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'yahooo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com',
  };

  const domain = normalized.split('@')[1];
  if (commonTypos[domain]) {
    return { 
      valid: false, 
      error: `Did you mean ${normalized.split('@')[0]}@${commonTypos[domain]}?` 
    };
  }

  // Block disposable email providers
  const disposableDomains = [
    'tempmail.com', 'throwaway.email', '10minutemail.com', 'guerrillamail.com',
    'mailinator.com', 'trashmail.com'
  ];

  if (disposableDomains.includes(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed' };
  }

  return { valid: true, normalized };
}

// ============================================
// LICENSE NUMBER VALIDATION (State-specific)
// ============================================
function validateLicenseNumber(licenseNumber, state) {
  if (!licenseNumber) {
    return { valid: false, error: 'License number is required' };
  }

  if (!state) {
    return { valid: false, error: 'License state is required' };
  }

  const cleaned = licenseNumber.toUpperCase().trim();

  // State-specific validation patterns
  const patterns = {
    CA: /^[A-Z0-9]{6,10}$/, // California: 6-10 alphanumeric
    TX: /^TACL[A-Z]?\d{5,8}$/, // Texas: TACL followed by optional letter and 5-8 digits
    FL: /^(CA|CAC|CMC)\d{7}$/, // Florida: CA/CAC/CMC followed by 7 digits
    NY: /^\d{6,9}$/, // New York: 6-9 digits
    AZ: /^(ROC|KB-\d)\d{6}$/, // Arizona: ROC or KB-# followed by 6 digits
    NV: /^\d{5,10}$/, // Nevada: 5-10 digits
    // Add more states as needed
  };

  const pattern = patterns[state];
  
  if (!pattern) {
    // Generic validation for states not listed
    if (cleaned.length < 4 || cleaned.length > 20) {
      return { valid: false, error: 'License number must be between 4-20 characters' };
    }
    return { valid: true, formatted: cleaned };
  }

  if (!pattern.test(cleaned)) {
    const examples = {
      CA: 'Example: 123456 or ABC1234',
      TX: 'Example: TACLB12345',
      FL: 'Example: CAC1234567',
      NY: 'Example: 123456',
      AZ: 'Example: ROC123456',
      NV: 'Example: 12345',
    };
    
    return { 
      valid: false, 
      error: `Invalid ${state} license format. ${examples[state] || 'Please check your license number'}` 
    };
  }

  return { valid: true, formatted: cleaned };
}

// ============================================
// TAX ID / EIN VALIDATION & FORMATTING
// ============================================
function validateAndFormatEIN(taxId) {
  if (!taxId) {
    // Tax ID is optional, but if provided, must be valid
    return { valid: true, formatted: null };
  }

  // Remove all non-digit characters
  const digitsOnly = taxId.replace(/\D/g, '');

  // Must be exactly 9 digits
  if (digitsOnly.length !== 9) {
    return { valid: false, error: 'Tax ID/EIN must be 9 digits (Format: XX-XXXXXXX)' };
  }

  // Validate first two digits (must be valid prefix)
  const validPrefixes = [
    '01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16',
    '20', '21', '22', '23', '24', '25', '26', '27', '30', '31', '32', '33', '34',
    '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47',
    '48', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61',
    '62', '63', '64', '65', '66', '67', '68', '71', '72', '73', '74', '75', '76',
    '77', '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91', '92',
    '93', '94', '95', '98', '99'
  ];

  const prefix = digitsOnly.substring(0, 2);
  if (!validPrefixes.includes(prefix)) {
    return { valid: false, error: 'Invalid Tax ID/EIN prefix' };
  }

  // Format as XX-XXXXXXX
  const formatted = `${digitsOnly.substring(0, 2)}-${digitsOnly.substring(2)}`;

  return { valid: true, formatted };
}

// ============================================
// ZIP CODE VALIDATION
// ============================================
function validateZipCode(zip) {
  if (!zip) {
    return { valid: false, error: 'ZIP code is required' };
  }

  // Remove any spaces or dashes
  const cleaned = zip.replace(/[\s-]/g, '');

  // Must be exactly 5 digits
  if (!/^\d{5}$/.test(cleaned)) {
    return { valid: false, error: 'ZIP code must be 5 digits' };
  }

  // Basic range validation (US ZIP codes range from 00501 to 99950)
  const zipNum = parseInt(cleaned);
  if (zipNum < 501 || zipNum > 99950) {
    return { valid: false, error: 'Invalid ZIP code range' };
  }

  return { valid: true, formatted: cleaned };
}

// ============================================
// STATE VALIDATION
// ============================================
function validateState(state) {
  if (!state) {
    return { valid: false, error: 'State is required' };
  }

  const validStates = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
  ];

  const upperState = state.toUpperCase().trim();

  if (!validStates.includes(upperState)) {
    return { valid: false, error: 'Invalid US state code' };
  }

  return { valid: true, formatted: upperState };
}

// ============================================
// CITY VALIDATION
// ============================================
function validateCity(city) {
  if (!city) {
    return { valid: false, error: 'City is required' };
  }

  const cleaned = city.trim();

  // Must be at least 2 characters
  if (cleaned.length < 2) {
    return { valid: false, error: 'City name must be at least 2 characters' };
  }

  // Must be at most 50 characters
  if (cleaned.length > 50) {
    return { valid: false, error: 'City name too long (max 50 characters)' };
  }

  // Only allow letters, spaces, hyphens, and apostrophes
  if (!/^[a-zA-Z\s\-']+$/.test(cleaned)) {
    return { valid: false, error: 'City name contains invalid characters' };
  }

  // Capitalize first letter of each word
  const formatted = cleaned
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return { valid: true, formatted };
}

// ============================================
// SERVICE ZIP CODES VALIDATION
// ============================================
async function validateServiceZipCodes(zipCodes, businessZip) {
  if (!zipCodes || zipCodes.length === 0) {
    return { valid: false, error: 'At least one service ZIP code is required' };
  }

  const validatedZips = [];
  const errors = [];

  for (const zip of zipCodes) {
    const validation = validateZipCode(zip);
    
    if (!validation.valid) {
      errors.push(`Invalid ZIP: ${zip} - ${validation.error}`);
    } else {
      validatedZips.push(validation.formatted);
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join(', ') };
  }

  // Remove duplicates
  const uniqueZips = [...new Set(validatedZips)];

  // Limit to reasonable number (e.g., 50 ZIP codes)
  if (uniqueZips.length > 50) {
    return { valid: false, error: 'Maximum 50 service ZIP codes allowed' };
  }

  // Optional: Check if business ZIP is in service area
  if (businessZip && !uniqueZips.includes(businessZip)) {
    // This is just a warning, not an error
    console.log(`⚠️  Business ZIP ${businessZip} not in service area`);
  }

  return { valid: true, formatted: uniqueZips };
}

// ============================================
// WEBSITE URL VALIDATION
// ============================================
function validateWebsiteUrl(url) {
  if (!url) {
    // Website is optional
    return { valid: true, formatted: null };
  }

  const trimmed = url.trim();

  // Add https:// if no protocol specified
  let fullUrl = trimmed;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    fullUrl = 'https://' + trimmed;
  }

  // Validate URL format
  if (!validator.isURL(fullUrl, { require_protocol: true })) {
    return { valid: false, error: 'Invalid website URL format' };
  }

  return { valid: true, formatted: fullUrl };
}

// ============================================
// BUSINESS NAME SANITIZATION
// ============================================
function sanitizeBusinessName(name) {
  if (!name) {
    return { valid: false, error: 'Business name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Business name must be at least 2 characters' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Business name too long (max 100 characters)' };
  }

  // Remove any potentially harmful characters but allow common business characters
  const cleaned = trimmed.replace(/[<>{}]/g, '');

  return { valid: true, formatted: cleaned };
}

// ============================================
// SERVICE TYPES VALIDATION
// ============================================
function validateServiceTypes(serviceTypes) {
  if (!serviceTypes || serviceTypes.length === 0) {
    return { valid: false, error: 'At least one service type is required' };
  }

  const validTypes = [
    'ac_repair',
    'hvac_installation',
    'system_replacement',
    'emergency_repair',
    'heating_repair',
    'maintenance_tuneups'
  ];

  const invalidTypes = serviceTypes.filter(type => !validTypes.includes(type));

  if (invalidTypes.length > 0) {
    return { 
      valid: false, 
      error: `Invalid service types: ${invalidTypes.join(', ')}` 
    };
  }

  if (serviceTypes.length < 2) {
    return { 
      valid: false, 
      error: 'Please select at least 2 service types' 
    };
  }

  return { valid: true, formatted: serviceTypes };
}

// ============================================
// YEARS IN BUSINESS VALIDATION
// ============================================
function validateYearsInBusiness(years) {
  if (years === undefined || years === null || years === '') {
    return { valid: true, formatted: 0 }; // Optional field
  }

  const num = parseInt(years);

  if (isNaN(num)) {
    return { valid: false, error: 'Years in business must be a number' };
  }

  if (num < 0) {
    return { valid: false, error: 'Years in business cannot be negative' };
  }

  if (num > 150) {
    return { valid: false, error: 'Years in business seems unrealistic (max 150)' };
  }

  return { valid: true, formatted: num };
}

// ============================================
// EXPORT ALL VALIDATORS
// ============================================
module.exports = {
  validateAndFormatPhone,
  validateEmail,
  validateLicenseNumber,
  validateAndFormatEIN,
  validateZipCode,
  validateState,
  validateCity,
  validateServiceZipCodes,
  validateWebsiteUrl,
  sanitizeBusinessName,
  validateServiceTypes,
  validateYearsInBusiness,
};