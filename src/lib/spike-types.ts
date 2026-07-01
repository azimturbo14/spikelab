export interface PlayerProfile {
  name: string;
  position: string;
  experience: string;
}

export interface CheckpointScores {
  approach_speed: number;
  approach_angle: number;
  last_step_length: number;
  footwork_rhythm: number;
  arms_swing_back: number;
  vertical_jump_conversion: number;
  hip_shoulder_rotation: number;
  body_position_air: number;
  bow_and_arrow: number;
  arm_swing_speed: number;
  contact_point: number;
  wrist_snap: number;
  contact_height: number;
  follow_through: number;
  landing_balance: number;
}

export interface PhaseAnalysis {
  score: number;
  feedback: string;
}

export interface PhaseAnalyses {
  approach: PhaseAnalysis;
  jump: PhaseAnalysis;
  contact: PhaseAnalysis;
  followThrough: PhaseAnalysis;
}

export interface SpikeAnalysis {
  scores: CheckpointScores;
  phaseAnalysis: PhaseAnalyses;
  topStrengths: string[];
  topWeaknesses: string[];
  coachNotes: string;
  estimatedLevel: string;
  estimatedApproachSpeed: string;
  overallPower: number;
}

export interface TrainingWeek {
  week: number;
  title: string;
  focus: string;
  days: TrainingDay[];
}

export interface TrainingDay {
  day: string;
  phase: string;
  drills: TrainingDrill[];
}

export interface TrainingDrill {
  name: string;
  sets: number;
  reps: string;
  cue: string;
  duration?: string;
  videoUrl?: string;
  equipment?: string;
  noEquipmentAlt?: string;
}

export interface TrainingPlan {
  weeks: TrainingWeek[];
  summary: string;
  keyFocus: string[];
}

export const CHECKPOINT_LABELS: Record<keyof CheckpointScores, { label: string; phase: string; description: string }> = {
  approach_speed: { label: "Approach Speed", phase: "Approach", description: "How fast and explosive is the approach run?" },
  approach_angle: { label: "Approach Angle", phase: "Approach", description: "Is the approach angle optimal (45-60 degrees toward net)?" },
  last_step_length: { label: "Last Step Length", phase: "Approach", description: "Is the braking step long enough to convert horizontal to vertical momentum?" },
  footwork_rhythm: { label: "Footwork Rhythm", phase: "Approach", description: "Is the slow-to-fast rhythm correct in the 3 or 4-step approach?" },
  arms_swing_back: { label: "Arms Swing Back on Plant", phase: "Approach", description: "Do both arms swing back during the plant to load elastic energy?" },
  vertical_jump_conversion: { label: "Vertical Jump Conversion", phase: "Jump", description: "How efficiently is horizontal momentum converted to vertical height?" },
  hip_shoulder_rotation: { label: "Hip-Shoulder Rotation", phase: "Jump", description: "Is there proper hip-shoulder separation (torque) before hitting?" },
  body_position_air: { label: "Body Position in Air", phase: "Jump", description: "Is the body in a good athletic position at peak height?" },
  bow_and_arrow: { label: "Bow-and-Arrow Position", phase: "Contact", description: "Is the hitting arm in a proper loading position (elbow high, hand behind head)?" },
  arm_swing_speed: { label: "Arm Swing Speed", phase: "Contact", description: "How fast and explosive is the arm whip through the hitting zone?" },
  contact_point: { label: "Contact Point", phase: "Contact", description: "Is contact at full extension, slightly in front of the hitting shoulder?" },
  wrist_snap: { label: "Wrist Snap (Topspin)", phase: "Contact", description: "Is there a strong wrist snap over the ball for topspin?" },
  contact_height: { label: "Contact Height", phase: "Contact", description: "How high is the contact point relative to the net?" },
  follow_through: { label: "Follow-Through", phase: "Follow-Through", description: "Does the arm continue across the body after contact?" },
  landing_balance: { label: "Landing Balance", phase: "Follow-Through", description: "Is the landing soft, two-footed, with knees bent?" },
};

export const POSITIONS = [
  "Outside Hitter",
  "Opposite",
  "Middle Blocker",
  "Setter",
  "Libero",
  "Right Side",
];

export const EXPERIENCE_LEVELS = [
  "Beginner (< 2 years)",
  "Intermediate (2-5 years)",
  "Advanced (5-10 years)",
  "Elite (10+ years)",
];

export function getScoreColor(score: number): string {
  if (score >= 76) return "text-emerald-600";
  if (score >= 51) return "text-amber-600";
  return "text-red-500";
}

export function getScoreBgColor(score: number): string {
  if (score >= 76) return "bg-emerald-500";
  if (score >= 51) return "bg-amber-500";
  return "bg-red-500";
}

export function getScoreLabel(score: number): string {
  if (score >= 90) return "Elite";
  if (score >= 76) return "Excellent";
  if (score >= 60) return "Decent";
  if (score >= 40) return "Needs Work";
  return "Critical";
}

export function getPhaseFromCheckpoint(key: keyof CheckpointScores): string {
  return CHECKPOINT_LABELS[key].phase;
}