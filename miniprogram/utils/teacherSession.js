const TEACHER_SESSION_KEY = "CURRENT_TEACHER";
const TEACHER_LOGOUT_GATE_KEY = "TEACHER_SESSION_EXITED";

function getStoredTeacherSession() {
  return String(wx.getStorageSync(TEACHER_SESSION_KEY) || "").trim();
}

function hasTeacherLogoutGate() {
  return !!String(wx.getStorageSync(TEACHER_LOGOUT_GATE_KEY) || "").trim();
}

function getApprovedTeacherId(teacherProfile = {}, isTeacher = false) {
  const teacherId = String(teacherProfile?.teacherId || "").trim();
  const teacherStatus = String(teacherProfile?.status || "").trim();
  return teacherId && teacherStatus === "active" && !!isTeacher ? teacherId : "";
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

  try {
    const res = await wx.cloud.callFunction({
      name: "teacherApply",
      data: {
        action: "get"
      }
    });
    const approvedTeacherId = getApprovedTeacherId(
      res.result?.teacherProfile || null,
      res.result?.isTeacher
    );

    if (!approvedTeacherId) {
      if (currentTeacher) {
        wx.removeStorageSync(TEACHER_SESSION_KEY);
      }
      return "";
    }

    if (hasLogoutGate) {
      return "";
    }

    if (currentTeacher === approvedTeacherId) {
      wx.removeStorageSync(TEACHER_LOGOUT_GATE_KEY);
      return currentTeacher;
    }

    return cacheApprovedTeacherSession(approvedTeacherId);
  } catch (err) {
    return currentTeacher || "";
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
