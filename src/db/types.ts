export interface Patient {
  id: number;
  file_number: string;
  full_name: string;
  normalized_name: string;
  phone: string | null;
  national_id: string | null;
  gender: 'male' | 'female';
  birth_date: string | null;
  age: number | null;
  diagnosis: string | null;
  notes: string | null;
  photo_url?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PatientDocuments {
  id: number;
  patient_id: number;
  separate_file_name: string | null;
  separate_file_size: number | null;
  separate_updated_at: string | null;
  program_file_name: string | null;
  program_file_size: number | null;
  program_updated_at: string | null;
  tests_file_name: string | null;
  tests_file_size: number | null;
  tests_updated_at: string | null;
  behavioral_plan_file_name: string | null;
  behavioral_plan_file_size: number | null;
  behavioral_plan_updated_at: string | null;
}

export interface PatientVideo {
  id: number;
  patient_id: number;
  original_name: string;
  stored_filename: string;
  file_size: number;
  duration: number | null;
  title: string | null;
  notes: string | null;
  created_at: string;
}

export interface PatientFullDetails extends Patient {
  documents: PatientDocuments | null;
  videos: PatientVideo[];
}

export interface PatientStats {
  totalPatients: number;
  todayPatients: number;
  malePatients: number;
  femalePatients: number;
  totalVideos: number;
  totalDocuments: number;
  totalStorageBytes: number;
  recycleBinCount: number;
}
