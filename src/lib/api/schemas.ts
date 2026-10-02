import { z } from "zod";

// Auth Schemas
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

// API Key Schemas
export const createApiKeySchema = z.object({
  name: z.string().min(1, "Key name is required").max(100),
  scopes: z.string().default("*"), // Comma-separated or "*"
});

// Fleet / Asset Schemas
export const createAssetSchema = z.object({
  code: z.string().min(1, "Asset code is required"),
  regNo: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  yom: z.number().int().optional().nullable(),
  chassisNo: z.string().optional().nullable(),
  engineNo: z.string().optional().nullable(),
  meterType: z.enum(["KM", "HOURS"]),
  categoryId: z.string().min(1, "Category is required"),
  projectId: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "DISPOSED"]).default("ACTIVE"),
});

export const updateAssetSchema = createAssetSchema.partial();

// Fuel Request Schemas
export const createFuelRequestSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  litres: z.number().positive("Litres must be greater than 0"),
  meterReading: z.number().nonnegative().optional().nullable(),
  readingType: z.enum(["KM", "HOURS"]).optional().nullable(),
  purpose: z.string().optional().nullable(),
  fuelKind: z.string().default("AUTO_DIESEL"),
  notes: z.string().optional().nullable(),
});

// Fuel Issue Schemas
export const createFuelIssueSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  litres: z.number().positive("Litres must be greater than 0"),
  meterReading: z.number().nonnegative().optional().nullable(),
  readingType: z.enum(["KM", "HOURS"]).optional().nullable(),
  fuelKind: z.string().default("AUTO_DIESEL"),
  source: z.string().min(1, "Source/pump is required"),
  bulkTankId: z.string().optional().nullable(),
  issueDate: z.string().datetime().optional(), // ISO date, defaults to now
  driverName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  fuelRequestId: z.string().optional().nullable(),
});

export const voidFuelIssueSchema = z.object({
  reason: z.string().min(5, "Void reason must be at least 5 characters"),
});

// Fuel Correction Schemas
export const createFuelCorrectionSchema = z.object({
  fuelIssueId: z.string().min(1, "Fuel issue ID is required"),
  correctedLitres: z.number().positive().optional(),
  correctedMeter: z.number().nonnegative().optional(),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

// Meter Reading Schemas
export const createMeterReadingSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  value: z.number().nonnegative("Reading value must be non-negative"),
  readingType: z.enum(["KM", "HOURS"]),
  readingDate: z.string().datetime().optional(),
  notes: z.string().optional().nullable(),
});

// Daily Condition Schemas
export const createDailyConditionSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  status: z.enum(["WORKING", "BREAKDOWN"]),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD").optional(),
  note: z.string().optional().nullable(),
});

// Tank Dips & Bulk Schemas
export const createTankDipSchema = z.object({
  tankId: z.string().optional(),
  dipLitres: z.number().nonnegative().optional(),
  litresCalculated: z.number().nonnegative().optional(),
  dipDate: z.string().datetime().optional(),
  note: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createBulkRequestSchema = z.object({
  bulkTankId: z.string().min(1, "Tank ID is required"),
  requestedLitres: z.number().positive(),
  notes: z.string().optional().nullable(),
});

// Service Record Schemas
export const createServiceRecordSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  serviceDate: z.string().datetime().optional(),
  serviceType: z.string().min(1, "Service type is required"),
  meterAtService: z.number().nonnegative().optional().nullable(),
  costCents: z.number().int().nonnegative().default(0),
  description: z.string().optional().nullable(),
  performedBy: z.string().optional().nullable(),
});

export const updateServiceRecordSchema = createServiceRecordSchema.partial();

// Meter Outage Schemas
export const openMeterOutageSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  startDate: z.string().optional(),
  reason: z.string().min(1, "Reason is required"),
  notes: z.string().optional().nullable(),
});

export const closeMeterOutageSchema = z.object({
  endDate: z.string().optional(),
  resolution: z.enum(["repaired", "replaced"]),
  resumeReading: z.number().nonnegative("Resume reading must be non-negative"),
  resolutionNotes: z.string().optional().nullable(),
});

export const editMeterOutageSchema = z.object({
  startDate: z.string().optional(),
  reason: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
  resolutionNotes: z.string().optional().nullable(),
});
