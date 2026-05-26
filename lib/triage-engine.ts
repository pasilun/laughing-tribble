export type FlowType =
  | 'komplementbyggnad'
  | 'komplementbostadshus'
  | 'tillbyggnad'
  | 'eldstad'
  | 'plank'
  | 'mur'
  | 'other'

export type Installation =
  | 'vatten'
  | 'avlopp'
  | 'eldstad'
  | 'rökkanal'
  | 'ventilation'
  | 'ändrad_bärande_konstruktion'

export type TriageInput = {
  flow_type: FlowType
  inom_detaljplan: boolean
  planned_area_m2: number
  planned_nockhoejd_m: number
  existing_lovfri_area_m2?: number
  planned_distance_to_grans_m: number
  planned_distance_to_allman_plats_m?: number | null
  installations?: Installation[]
  strandskyddsomrade?: boolean
  k_marking?: boolean
  huvudbyggnad_type?: string
  detaljplan_violated?: boolean
  utokad_lovplikt?: boolean
}

export type TriageResult = {
  bucket: 'LOVFRI' | 'ANMALAN' | 'BYGGLOV' | null
  bucket_reasons: string[]
  obligations: string[]
  out_of_scope: boolean
  out_of_scope_reason?: string
}

type Bucket = 'LOVFRI' | 'ANMALAN' | 'BYGGLOV'

const BUCKET_ORDER: Record<Bucket, number> = { LOVFRI: 1, ANMALAN: 2, BYGGLOV: 3 }

function maxBucket(a: Bucket, b: Bucket): Bucket {
  return BUCKET_ORDER[a] >= BUCKET_ORDER[b] ? a : b
}

const KOMPLEMENT_FLOWS: FlowType[] = ['komplementbyggnad', 'komplementbostadshus']

export function assessPermitRequirement(input: TriageInput): TriageResult {
  const {
    flow_type,
    inom_detaljplan,
    planned_area_m2,
    planned_nockhoejd_m,
    existing_lovfri_area_m2 = 0,
    planned_distance_to_grans_m,
    planned_distance_to_allman_plats_m,
    installations = [],
    strandskyddsomrade = false,
    k_marking = false,
    huvudbyggnad_type,
    detaljplan_violated = false,
    utokad_lovplikt = false,
  } = input

  // --- Out of scope checks ---

  // T-001: Unsupported flow type
  if (flow_type === 'other') {
    return {
      bucket: null,
      bucket_reasons: [],
      obligations: [],
      out_of_scope: true,
      out_of_scope_reason: 'TRIAGE-OUT-OF-SCOPE-FLOW',
    }
  }

  // T-002: K-märkning
  if (k_marking) {
    return {
      bucket: null,
      bucket_reasons: [],
      obligations: [],
      out_of_scope: true,
      out_of_scope_reason: 'TRIAGE-OUT-OF-SCOPE-KMARKNING',
    }
  }

  // T-003: No huvudbyggnad for komplement/tillbyggnad
  if (
    (KOMPLEMENT_FLOWS.includes(flow_type) || flow_type === 'tillbyggnad') &&
    huvudbyggnad_type !== 'en-/tvåbostadshus'
  ) {
    return {
      bucket: null,
      bucket_reasons: [],
      obligations: [],
      out_of_scope: true,
      out_of_scope_reason: 'TRIAGE-NO-HUVUDBYGGNAD',
    }
  }

  // --- Bucket and obligations accumulation ---

  let bucket: Bucket | null = null
  const bucketReasons: string[] = []
  const obligations: string[] = []

  // --- Bygglov checks ---

  // T-004: Strandskyddsdispens needed
  if (strandskyddsomrade) {
    bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
    if (!bucketReasons.includes('TRIAGE-STRANDSKYDD-DISPENS-REQUIRED')) {
      bucketReasons.push('TRIAGE-STRANDSKYDD-DISPENS-REQUIRED')
    }
  }

  // T-005: Detaljplan violation
  if (detaljplan_violated) {
    bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
    if (!bucketReasons.includes('TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT')) {
      bucketReasons.push('TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT')
    }
  }

  // T-006: Utökad lovplikt
  if (utokad_lovplikt) {
    bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
    if (!bucketReasons.includes('TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT')) {
      bucketReasons.push('TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT')
    }
  }

  // T-007: Komplementbyggnad/-bostadshus över pott
  if (KOMPLEMENT_FLOWS.includes(flow_type)) {
    const totalArea = existing_lovfri_area_m2 + planned_area_m2
    let overPott = false
    if (inom_detaljplan) {
      overPott = totalArea > 45 || planned_area_m2 > 30 || planned_nockhoejd_m > 4.0
    } else {
      overPott = totalArea > 65 || planned_area_m2 > 50 || planned_nockhoejd_m > 4.5
    }
    if (overPott) {
      bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
      if (!bucketReasons.includes('TRIAGE-BYGGLOV-OVER-POTT')) {
        bucketReasons.push('TRIAGE-BYGGLOV-OVER-POTT')
      }
    }
  }

  // T-008: Tillbyggnad över limits
  if (flow_type === 'tillbyggnad' && planned_area_m2 > 30) {
    bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
    if (!bucketReasons.includes('TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS')) {
      bucketReasons.push('TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS')
    }
  }

  // T-009: Plank eller mur
  if (flow_type === 'plank' || flow_type === 'mur') {
    bucket = bucket ? maxBucket(bucket, 'BYGGLOV') : 'BYGGLOV'
    if (!bucketReasons.includes('TRIAGE-BYGGLOV-PLANK-MUR')) {
      bucketReasons.push('TRIAGE-BYGGLOV-PLANK-MUR')
    }
  }

  // --- Anmälan checks (only add if bucket != BYGGLOV) ---

  // T-010: Eldstad eller rökkanal
  if (
    flow_type === 'eldstad' ||
    installations.includes('eldstad') ||
    installations.includes('rökkanal')
  ) {
    const candidate: Bucket = 'ANMALAN'
    bucket = bucket ? maxBucket(bucket, candidate) : candidate
    if (!bucketReasons.includes('TRIAGE-ANMALAN-ELDSTAD')) {
      bucketReasons.push('TRIAGE-ANMALAN-ELDSTAD')
    }
  }

  // T-011: Vatten/avlopp
  if (installations.includes('vatten') || installations.includes('avlopp')) {
    const candidate: Bucket = 'ANMALAN'
    bucket = bucket ? maxBucket(bucket, candidate) : candidate
    if (!bucketReasons.includes('TRIAGE-ANMALAN-VATTEN-AVLOPP')) {
      bucketReasons.push('TRIAGE-ANMALAN-VATTEN-AVLOPP')
    }
  }

  // T-012: Ändrad bärande konstruktion
  if (installations.includes('ändrad_bärande_konstruktion')) {
    const candidate: Bucket = 'ANMALAN'
    bucket = bucket ? maxBucket(bucket, candidate) : candidate
    if (!bucketReasons.includes('TRIAGE-ANMALAN-BARANDE')) {
      bucketReasons.push('TRIAGE-ANMALAN-BARANDE')
    }
  }

  // --- Default LOVFRI ---

  // T-015/T-016: Default LOVFRI for supported flow types without higher bucket
  if (bucket === null) {
    if (KOMPLEMENT_FLOWS.includes(flow_type) || flow_type === 'eldstad') {
      bucket = 'LOVFRI'
      bucketReasons.push('TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD')
    } else if (flow_type === 'tillbyggnad') {
      bucket = 'LOVFRI'
      bucketReasons.push('TRIAGE-LOVFRI-TILLBYGGNAD')
    }
  }

  // --- Always-applies obligations ---

  // O-001: BBR applies
  obligations.push('OBLIGATION-BBR-APPLIES')

  // O-002: EKS applies
  obligations.push('OBLIGATION-EKS-APPLIES')

  // O-003: Grannmedgivande < 4.5m
  if (
    planned_distance_to_grans_m < 4.5 &&
    (planned_distance_to_allman_plats_m == null || planned_distance_to_allman_plats_m >= 4.5)
  ) {
    obligations.push('OBLIGATION-GRANNMEDGIVANDE-REQUIRED')
  }

  // O-004: Avstånd till allmän plats - BLOCKING
  if (planned_distance_to_allman_plats_m != null && planned_distance_to_allman_plats_m < 4.5) {
    obligations.push('BLOCKING-AVSTAND-ALLMAN-PLATS')
  }

  // O-006: Strandskydd within 100m (using same boolean field)
  if (strandskyddsomrade) {
    obligations.push('OBLIGATION-STRANDSKYDD-CHECK')
  }

  return {
    bucket,
    bucket_reasons: bucketReasons,
    obligations,
    out_of_scope: false,
  }
}
