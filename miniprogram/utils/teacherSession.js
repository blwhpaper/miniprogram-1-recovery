const TEACHER_SESSION_KEY = "CURRENT_TEACHER";
const TEACHER_LOGOUT_GATE_KEY = "TEACHER_SESSION_EXITED";
const TEACHER_SESSION_CACHE_TTL = 10000;

let approvedTeacherSessionPromise = null;
let approvedTeacherSessionCache = {
  value: "",
  expiresAt: 0
};

function getStoredTeacherSession() {
  return String(wx.getStorageSync(TEACHER_SESSION_KEY) || "").trim();
}

function hasTeacherLogoutGate() {
  return !!String(wx.getStorageSync(TEACHER_LOGOUT_GATE_KEY) || "").trim();
}

function getApprovedTeacherId(teacherProfile = {}) {
  const teacherId = String(teacherProfile?.teacherId || "").trim();
  const teacherStatus = String(teacherProfile?.status || "").trim();
  return teacherId && teacherStatus === "active" ? teacherId : "";
}

function cacheApprovedTeacherSession(teacherId = "") {
  const normalizedTeacherId = String(teacherId || "").trim();
  if (!normalizedTeacherId) return "";

  wx.removeStorageSync(TEACHER_LOGOUT_GATE_KEY);
  wx.setStorageSync(TEACHER_SESSION_KEY, normalizedTeacherId);
  return normalizedTeacherId;
}

async function ensureApprovedTeacherSession() {
  const currentTeacher = getStoredTeacherSession();
  const hasLogoutGate = hasTeacherLogoutGate();
  if (!currentTeacher && hasLogoutGate) {
    return "";
  }

  const now = Date.now();
  if (
    approvedTeacherSessionCache.expiresAt > now &&
    approvedTeacherSessionCache.value === currentTeacher
  ) {
    return approvedTeacherSessionCache.value;
  }

  if (approvedTeacherSessionPromise) {
    return approvedTeacherSessionPromise;
  }

  approvedTeacherSessionPromise = (async () => {
    const res = await wx.cloud.callFunction({
      name: "teacherApply",
      data: {
        action: "get"
      }
    });
    const approvedTeacherId = getApprovedTeacherId(res.result?.teacherProfile || null);

    if (!approvedTeacherId) {
      if (currentTeacher) {
        wx.removeStorageSync(TEACHER_SESSION_KEY);
      }
      approvedTeacherSessionCache = {
        value: "",
        expiresAt: 0
      };
      return "";
    }

    if (hasLogoutGate) {
      return "";
    }

    if (currentTeacher === approvedTeacherId) {
      wx.removeStorageSync(TEACHER_LOGOUT_GATE_KEY);
      approvedTeacherSessionCache = {
        value: currentTeacher,
        expiresAt: Date.now() + TEACHER_SESSION_CACHE_TTL
      };
      return currentTeacher;
    }

    const cachedTeacherId = cacheApprovedTeacherSession(approvedTeacherId);
    approvedTeacherSessionCache = {
      value: cachedTeacherId,
      expiresAt: Date.now() + TEACHER_SESSION_CACHE_TTL
    };
    return cachedTeacherId;
  })().catch((err) => {
    if (currentTeacher) {
      wx.removeStorageSync(TEACHER_SESSION_KEY);
    }
    approvedTeacherSessionCache = {
      value: "",
      expiresAt: 0
    };
    return "";
  }).finally(() => {
    approvedTeacherSessionPromise = null;
  });

  try {
    return await approvedTeacherSessionPromise;
  } catch (err) {
    return "";
  }
}

module.exports = {
  TEACHER_LOGOUT_GATE_KEY,
  getStoredTeacherSession,
  hasTeacherLogoutGate,
  getApprovedTeacherId,
  cacheApprovedTeacherSession,
  ensureApprovedTeacherSession
};
