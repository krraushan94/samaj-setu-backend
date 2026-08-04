// Auto-priority: women safety categories trigger CRITICAL when submitter is female
const WOMEN_SAFETY_CATEGORIES = [
  'eve_teasing', 'harassment', 'domestic_violence',
  'stalking', 'chain_snatching', 'unsafe_area',
];

const ISSUE_CATEGORIES = {
  infrastructure: ['street_light', 'road_damage', 'pothole', 'water_supply', 'drainage', 'public_toilet', 'bridge', 'disability_access'],
  women_safety:   WOMEN_SAFETY_CATEGORIES,
  security:       ['theft', 'robbery', 'threat', 'illegal_parking', 'unlawful_activity'],
  land_property:  ['land_dispute', 'illegal_construction', 'encroachment', 'property_dispute'],
  health:         ['open_defecation', 'mosquito_breeding', 'garbage_dumping', 'hospital_complaint', 'epidemic_alert'],
  education:      ['school_infrastructure', 'teacher_absenteeism', 'midday_meal', 'dropout_concern'],
  environment:    ['illegal_tree_cutting', 'water_body_encroachment', 'pollution', 'stray_animals'],
  social:         ['drug_abuse', 'child_labour', 'needs_support', 'domestic_abuse', 'elder_abuse', 'caste_discrimination', 'mental_health_crisis'],
  missing:        ['missing_person', 'missing_child', 'medical_emergency'],
  development:    ['work_complaint', 'fund_misuse', 'development_suggestion'],
  feedback:       ['appreciation', 'suggestion', 'event_feedback', 'general_comment'],
  others:         ['general', 'any_other'],
};

// Categories where the ₹50 fee is waived — public-good infrastructure and safety/emergency issues
// should never have a cost barrier between a citizen and help.
const PAYMENT_EXEMPT_GROUPS = ['infrastructure', 'women_safety', 'missing'];
// Individual sub-categories exempt even though their group is normally paid — these are
// vulnerable-person safety matters, not everyday complaints.
const PAYMENT_EXEMPT_SUBCATEGORY_LABELS = ['Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis'];

// Categories that must never surface on the PUBLIC community board, regardless of the
// is_anonymous flag — these stay strictly citizen ↔ team ↔ admin to protect the reporter
// and avoid enabling defamation/retaliation against a named individual.
const NEVER_PUBLIC_GROUPS = ['women_safety'];
const NEVER_PUBLIC_SUBCATEGORY_LABELS = ['Threat/Dhamki', 'Domestic Abuse', 'Elder Abuse / Neglect', 'Caste-Based Discrimination', 'Mental Health Crisis'];

// Department auto-routing based on category
const CATEGORY_DEPARTMENT_MAP = {
  infrastructure:  'Social Welfare',
  women_safety:    'Social Welfare',
  security:        'Social Welfare',
  health:          'Social Welfare',
  education:       'Social Welfare',
  social:          'Social Welfare',
  missing:         'Social Welfare',
  land_property:   'Others',
  environment:     'Others',
  development:     'Politics',
  feedback:        'Marketing',
  others:          'Others',
};

const TICKET_STATUSES = ['payment_pending', 'open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES      = ['low', 'medium', 'high', 'critical'];
const DEPARTMENTS     = ['Politics', 'Marketing', 'Social Welfare', 'Others'];
const ADMIN_USERNAME  = process.env.ADMIN_USERNAME || 'Admin_Raushan';

module.exports = {
  WOMEN_SAFETY_CATEGORIES,
  ISSUE_CATEGORIES,
  CATEGORY_DEPARTMENT_MAP,
  PAYMENT_EXEMPT_GROUPS,
  PAYMENT_EXEMPT_SUBCATEGORY_LABELS,
  NEVER_PUBLIC_GROUPS,
  NEVER_PUBLIC_SUBCATEGORY_LABELS,
  TICKET_STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  ADMIN_USERNAME,
};
