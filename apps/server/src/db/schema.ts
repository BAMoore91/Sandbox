import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "viewer"] }).notNull().default("viewer"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
});

export const cameras = sqliteTable(
  "cameras",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Primary RTSP URL (encrypted at rest in a later phase)
    rtspUrl: text("rtsp_url").notNull(),
    // Optional substream URL for low-bandwidth tiles
    subRtspUrl: text("sub_rtsp_url"),
    // ONVIF device service URL (for PTZ, events, snapshots)
    onvifUrl: text("onvif_url"),
    username: text("username"),
    // Encrypted blob; null until phase that adds secret encryption
    passwordEnc: text("password_enc"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    aiEnabled: integer("ai_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    // JSON: per-label thresholds + polygon zones
    aiConfig: text("ai_config"),
    // Retention override; null = use global default
    retentionDays: integer("retention_days"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    enabledIdx: index("cameras_enabled_idx").on(t.enabled),
  }),
);

export const recordings = sqliteTable(
  "recordings",
  {
    id: text("id").primaryKey(),
    cameraId: text("camera_id")
      .notNull()
      .references(() => cameras.id, { onDelete: "cascade" }),
    // Absolute path on disk
    filePath: text("file_path").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // 'h264' | 'h265' | other
    codec: text("codec").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (t) => ({
    camStartIdx: index("recordings_cam_start_idx").on(
      t.cameraId,
      t.startedAt,
    ),
    startIdx: index("recordings_start_idx").on(t.startedAt),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    cameraId: text("camera_id")
      .notNull()
      .references(() => cameras.id, { onDelete: "cascade" }),
    // 'ai_detection' | 'motion' | 'camera_offline' | 'camera_online'
    type: text("type").notNull(),
    // For AI: 'person' | 'car' | 'truck' | etc.
    label: text("label"),
    confidence: integer("confidence"), // 0..100
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    // JSON: bbox, zones triggered, clip pointers
    metadata: text("metadata"),
    thumbnailPath: text("thumbnail_path"),
  },
  (t) => ({
    camTypeStartIdx: index("events_cam_type_start_idx").on(
      t.cameraId,
      t.type,
      t.startedAt,
    ),
    startIdx: index("events_start_idx").on(t.startedAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Camera = typeof cameras.$inferSelect;
export type NewCamera = typeof cameras.$inferInsert;
export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
