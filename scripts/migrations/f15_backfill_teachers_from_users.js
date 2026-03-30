#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function requireWxServerSdk() {
  const candidatePaths = [
    path.join(
      __dirname,
      "..",
      "..",
      "cloudfunctions",
      "teacherApply",
      "node_modules",
      "wx-server-sdk"
    ),
    path.join(
      __dirname,
      "..",
      "..",
      "cloudfunctions",
      "createSignCode",
      "node_modules",
      "wx-server-sdk"
    )
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return require(candidatePath);
    } catch (err) {}
  }

  return require("wx-server-sdk");
}

function resolveCloudEnv() {
  const appJsPath = path.join(__dirname, "..", "..", "miniprogram", "app.js");
  const source = fs.readFileSync(appJsPath, "utf8");
  const matched = source.match(/env:\s*"([^"]+)"/);
  return matched ? String(matched[1] || "").trim() : "";
}

function resolveCloudCredentials() {
  const secretId = String(
    process.env.TENCENTCLOUD_SECRET_ID ||
    process.env.SecretId ||
    ""
  ).trim();
  const secretKey = String(
    process.env.TENCENTCLOUD_SECRET_KEY ||
    process.env.SecretKey ||
    ""
  ).trim();

  return {
    secretId,
    secretKey
  };
}

function normalizeApplication(application = {}, openid = "") {
  if (!application || typeof application !== "object") return null;
  const status = String(application.status || "").trim();
  const applicantName = String(application.applicantName || "").trim();
  const contactInfo = String(application.contactInfo || "").trim();
  if (!status && !applicantName && !contactInfo) return null;
  return {
    applicantOpenId: String(application.applicantOpenId || openid || "").trim(),
    applicantName,
    contactInfo,
    status,
    createdAt: application.createdAt || null,
    updatedAt: application.updatedAt || null,
    reviewedAt: application.reviewedAt || null,
    reviewedByOpenId: String(application.reviewedByOpenId || "").trim()
  };
}

function normalizeTeacherProfile(profile = {}) {
  if (!profile || typeof profile !== "object") return null;
  const teacherId = String(profile.teacherId || "").trim();
  const status = String(profile.status || "").trim();
  if (!teacherId && !status) return null;
  return {
    teacherId,
    status,
    approvedAt: profile.approvedAt || null,
    updatedAt: profile.updatedAt || null
  };
}

function normalizeRoles(roles = {}) {
  if (!roles || typeof roles !== "object") {
    return { teacher: false };
  }
  return {
    ...roles,
    teacher: !!roles.teacher
  };
}

function normalizeTeacherRecord(record = {}) {
  if (!record || typeof record !== "object") return null;
  const userOpenid = String(record.userOpenid || record.openid || "").trim();
  const teacherId = String(record.teacherId || "").trim();
  const status = String(record.status || "").trim();
  if (!userOpenid && !teacherId && !status) return null;
  return {
    userOpenid,
    openid: String(record.openid || userOpenid).trim(),
    teacherId,
    status
  };
}

function hasExistingTeacherRecord(record = {}) {
  const normalized = normalizeTeacherRecord(record);
  return !!(normalized && normalized.userOpenid);
}

function isHistoricalTeacher(user = {}) {
  const openid = String(user?._openid || "").trim();
  const teacherProfile = normalizeTeacherProfile(user?.teacherProfile);
  const application = normalizeApplication(user?.teacherApplication, openid);
  const roles = normalizeRoles(user?.roles);
  const teacherId = String(teacherProfile?.teacherId || "").trim();
  if (!teacherId) return false;

  return (
    teacherProfile?.status === "active" ||
    roles.teacher === true ||
    String(application?.status || "").trim() === "approved"
  );
}

function buildBackfillTeacherRecord(user = {}) {
  const openid = String(user?._openid || "").trim();
  const application = normalizeApplication(user?.teacherApplication, openid);
  const teacherProfile = normalizeTeacherProfile(user?.teacherProfile);
  const teacherId = String(teacherProfile?.teacherId || "").trim();
  const applicantName = String(application?.applicantName || user?.name || "").trim();
  const contactInfo = String(application?.contactInfo || "").trim();
  const appliedAt = application?.createdAt || application?.updatedAt || teacherProfile?.approvedAt || null;
  const approvedAt = teacherProfile?.approvedAt || application?.reviewedAt || application?.updatedAt || application?.createdAt || null;
  const updatedAt = teacherProfile?.updatedAt || application?.updatedAt || approvedAt || null;
  const createdAt = application?.createdAt || approvedAt || null;

  return {
    openid,
    userOpenid: openid,
    teacherId,
    name: applicantName,
    contactInfo,
    phone: contactInfo,
    status: "active",
    isTestTeacher: true,
    applicationId: String(user?._id || "").trim(),
    appliedAt,
    createdAt,
    updatedAt,
    approvedAt,
    approvedBy: String(application?.reviewedByOpenId || "").trim()
  };
}

async function fetchAllDocs(collection) {
  const pageSize = 100;
  let skip = 0;
  const rows = [];

  while (true) {
    const res = await collection.skip(skip).limit(pageSize).get();
    const data = res.data || [];
    rows.push(...data);
    if (data.length < pageSize) break;
    skip += pageSize;
  }

  return rows;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const isApply = args.has("--apply");
  const isDryRun = !isApply || args.has("--dry-run");
  const env = resolveCloudEnv();
  const { secretId, secretKey } = resolveCloudCredentials();

  if (!env) {
    throw new Error("无法从 miniprogram/app.js 解析云环境 ID");
  }

  if (!secretId && !secretKey) {
    throw new Error("缺少腾讯云凭证环境变量：请设置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY（或 SecretId / SecretKey）");
  }

  if (!secretId) {
    throw new Error("缺少腾讯云凭证环境变量：TENCENTCLOUD_SECRET_ID（或 SecretId）");
  }

  if (!secretKey) {
    throw new Error("缺少腾讯云凭证环境变量：TENCENTCLOUD_SECRET_KEY（或 SecretKey）");
  }

  const cloud = requireWxServerSdk();
  cloud.init({
    env,
    secretId,
    secretKey
  });
  const db = cloud.database();

  const summary = {
    env,
    mode: isApply ? "apply" : "dry-run",
    scannedTotal: 0,
    existingCount: 0,
    createdCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: []
  };

  const [usersList, teachersList] = await Promise.all([
    fetchAllDocs(db.collection("users")),
    fetchAllDocs(db.collection("teachers")).catch((err) => {
      throw new Error(`读取 teachers 集合失败: ${err.message || err.errMsg || err}`);
    })
  ]);

  const teachersByOpenid = new Map();
  teachersList.forEach((item) => {
    const normalized = normalizeTeacherRecord(item);
    if (!normalized?.userOpenid) return;
    teachersByOpenid.set(normalized.userOpenid, {
      docId: String(item._id || "").trim(),
      record: normalized
    });
  });

  const historicalTeachers = usersList.filter((user) => isHistoricalTeacher(user));
  summary.scannedTotal = historicalTeachers.length;

  for (const user of historicalTeachers) {
    const openid = String(user?._openid || "").trim();
    const teacherId = String(user?.teacherProfile?.teacherId || "").trim();
    const exists = teachersByOpenid.get(openid);

    if (exists) {
      summary.existingCount += 1;
      continue;
    }

    if (!openid || !teacherId) {
      summary.skippedCount += 1;
      summary.errors.push({
        openid,
        reason: "missing_required_identity",
        teacherId
      });
      continue;
    }

    const patch = buildBackfillTeacherRecord(user);

    if (!isApply) {
      summary.createdCount += 1;
      console.log("[dry-run] will backfill teacher:", {
        openid,
        teacherId: patch.teacherId,
        name: patch.name,
        contactInfo: patch.contactInfo
      });
      continue;
    }

    try {
      await db.collection("teachers").add({ data: patch });
      summary.createdCount += 1;
    } catch (err) {
      summary.errorCount += 1;
      summary.errors.push({
        openid,
        teacherId,
        reason: "add_failed",
        message: String(err?.message || err?.errMsg || err)
      });
    }
  }

  console.log("\nF15 teachers backfill summary");
  console.log(JSON.stringify({
    env: summary.env,
    mode: summary.mode,
    scannedTotal: summary.scannedTotal,
    existingCount: summary.existingCount,
    createdCount: summary.createdCount,
    skippedCount: summary.skippedCount,
    errorCount: summary.errorCount,
    errorSamples: summary.errors.slice(0, 10)
  }, null, 2));

  if (summary.errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("F15 teachers backfill failed:", err);
  process.exit(1);
});
