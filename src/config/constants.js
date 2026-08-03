// Auto-priority: women safety categories trigger CRITICAL when submitter is female
const WOMEN_SAFETY_CATEGORIES = [
  'eve_teasing', 'harassment', 'domestic_violence',
  'stalking', 'chain_snatching', 'unsafe_area',
];

const ISSUE_CATEGORIES = {
  infrastructure: ['street_light', 'road_damage', 'pothole', 'water_supply', 'drainage', 'public_toilet', 'bridge'],
  women_safety:   WOMEN_SAFETY_CATEGORIES,
  security:       ['theft', 'robbery', 'threat', 'illegal_parking', 'antisocial'],
  land_property:  ['land_dispute', 'illegal_construction', 'encroachment', 'property_dispute'],
  health:         ['open_defecation', 'mosquito_breeding', 'garbage_dumping', 'hospital_complaint', 'epidemic_alert'],
  education:      ['school_infrastructure', 'teacher_absenteeism', 'midday_meal', 'dropout_concern'],
  environment:    ['illegal_tree_cutting', 'water_body_encroachment', 'pollution', 'stray_animals'],
  social:         ['drug_abuse', 'child_labour', 'beggar_menace', 'domestic_abuse'],
  missing:        ['missing_person', 'missing_child', 'medical_emergency'],
  development:    ['work_complaint', 'fund_misuse', 'development_suggestion'],
  feedback:       ['appreciation', 'suggestion', 'event_feedback', 'general_comment'],
  others:         ['general', 'any_other'],
};

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
  TICKET_STATUSES,
  PRIORITIES,
  DEPARTMENTS,
  ADMIN_USERNAME,
};
