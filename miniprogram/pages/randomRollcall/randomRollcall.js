const db = wx.cloud.database()
const _ = db.command
const { ensureApprovedTeacherSession } = require("../../utils/teacherSession");
const ROLLCALL_EVENT_TYPES = ["rollcall", "answer_score"];

Page({
  data: {
    classId: "",
    lessonId: "",
    pageLoading: false,
    pageErrorText: "",
    lessons: [],
    selectedLessonId: "",
    currentLessonLabel: "",
    currentManagedLessonId: "",
    baseRosterList: [],
    list: [], // 最终展示的混合列表
    signedStudents: [],
    currentCalledStudent: null,
    lessonEvents: [],
    displayLessonEvents: [],
    lessonEventsLoading: false,
    interactionScoreOptions: [60, 80, 95],
    selectedScore: 0,
    recordSubmitting: false,
    displayPhase: "idle",
    displayLeftText: "0",
    displayRightText: "0",
    verifyStartedAt: 0,
    verifyEndsAt: 0,
    verifySecondsLeft: 10,
    verifyProgressPercent: 100,
    countdownSecondsLeft: 60,
    currentRound: 1,
    currentRoundCalledIds: [],
    currentRoundProgressCount: 0,
    currentRoundTotalCount: 0,
    lessonCalledCount: 0,
    lessonSignedCount: 0,
    pendingScoreLock: false,
    lastScoredStudentName: "",
    lastScoredRound: 0,
    isRolling: false,
    diceLeftValue: 2,
    diceRightValue: 5,
    diceLeftText: "0",
    diceRightText: "0",
    diceTextMode: false,
    leftDicePips: [],
    rightDicePips: []
  },

  attendancePollingTimer: null,
  attendancePollingLessonId: "",
  lessonEventPollingTimer: null,
  lessonEventPollingLessonId: "",
  latestAttendanceDocs: [],
  latestClassRollcallEvents: [],
  recentAnswerScoreKeys: new Set(),
  isInitializing: false,
  rollAnimationTimer: null,
  rollAnimationFinishTimer: null,
  verifyDisplayTimer: null,
  countdownDisplayTimer: null,
  continuationContextCache: {},
  rollingDurationSeconds: 6,
  verifyDurationSeconds: 10,
  verifyDurationMs: 10000,
  thinkingDurationSeconds: 60,

  async ensureTeacherPageAccess() {
    const currentTeacher = await ensureApprovedTeacherSession();
    if (!currentTeacher) {
      this.clearAttendancePolling();
      this.clearLessonEventPolling();
      wx.reLaunch({
        url: "/pages/teacherHome/teacherHome"
      });
      return false;
    }
    return true;
  },

  normalizeRosterItem(student) {
    if (typeof student === "string") {
      return {
        studentId: "",
        name: student,
        gender: "",
        status: "unsigned",
        statusLabel: "未签到",
        answerScoreText: "",
        questionScoreText: "",
        testScoreText: "",
        attendanceScoreText: "",
        answerScoreAvgText: "",
        questionScoreAvgText: "",
        testScoreAvgText: "",
        lessonScoreText: "",
        lessonScoreBreakdownText: ""
      };
    }

    return {
      studentId: String(student?.studentId || student?.id || "").trim(),
      name: String(student?.name || "").trim(),
      gender: String(student?.gender || student?.sex || student?.studentGender || "").trim(),
      status: "unsigned",
      statusLabel: "未签到",
      answerScoreText: "",
      questionScoreText: "",
      testScoreText: "",
      attendanceScoreText: "",
      answerScoreAvgText: "",
      questionScoreAvgText: "",
      testScoreAvgText: "",
      lessonScoreText: "",
      lessonScoreBreakdownText: ""
    };
  },

  getAvatarTypeByGender(gender = "") {
    const normalizedGender = String(gender || "").trim().toLowerCase();
    if (["male", "m", "boy", "man", "男", "1"].includes(normalizedGender)) {
      return "male";
    }
    if (["female", "f", "girl", "woman", "女", "0", "2"].includes(normalizedGender)) {
      return "female";
    }
    return "default";
  },

  cloneBaseRosterList() {
    return (this.data.baseRosterList || []).map((item) => ({ ...item }));
  },

  getDicePips(value = 1) {
    const normalizedValue = Math.min(6, Math.max(1, Number(value || 1)));
    const pipMap = {
      1: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      2: [1, 0, 0, 0, 0, 0, 0, 0, 1],
      3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
      5: [1, 0, 1, 0, 1, 0, 1, 0, 1],
      6: [1, 0, 1, 1, 0, 1, 1, 0, 1]
    };

    return (pipMap[normalizedValue] || pipMap[1]).map((active, index) => ({
      key: `${normalizedValue}-${index}`,
      active: !!active
    }));
  },

  setDiceDisplay(leftValue = 1, rightValue = 1) {
    const nextLeftValue = Math.min(6, Math.max(1, Number(leftValue || 1)));
    const nextRightValue = Math.min(6, Math.max(1, Number(rightValue || 1)));
    this.setData({
      diceLeftValue: nextLeftValue,
      diceRightValue: nextRightValue,
      diceLeftText: String(nextLeftValue),
      diceRightText: String(nextRightValue),
      diceTextMode: true,
      leftDicePips: this.getDicePips(nextLeftValue),
      rightDicePips: this.getDicePips(nextRightValue)
    });
  },

  getStudentIdLastTwoDigits(studentId = "") {
    const normalizedId = String(studentId || "").trim();
    if (!normalizedId) {
      return {
        leftText: "0",
        rightText: "0",
        displayText: "00"
      };
    }

    const lastTwoText = normalizedId.slice(-2).padStart(2, "0");
    const leftText = lastTwoText.slice(0, 1);
    const rightText = lastTwoText.slice(1);

    return {
      leftText,
      rightText,
      displayText: lastTwoText
    };
  },

  setNumberCardDisplayByStudentId(studentId = "") {
    const { leftText, rightText } = this.getStudentIdLastTwoDigits(studentId);
    this.setData({
      diceLeftText: leftText,
      diceRightText: rightText,
      diceTextMode: true
    });
  },

  setNumberCardFinalDisplay(studentId = "") {
    const { leftText, rightText } = this.getStudentIdLastTwoDigits(studentId);
    this.setData({
      diceLeftValue: 0,
      diceRightValue: 0,
      diceLeftText: leftText,
      diceRightText: rightText,
      diceTextMode: true,
      leftDicePips: [],
      rightDicePips: []
    });
  },

  resetDiceDisplay() {
    this.setData({
      diceLeftValue: 0,
      diceRightValue: 0,
      diceLeftText: "0",
      diceRightText: "0",
      diceTextMode: true,
      leftDicePips: [],
      rightDicePips: []
    });
  },

  getDiceValuesForStudent(student = {}, round = 1) {
    const source = `${String(student.studentId || "").trim()}|${String(student.name || "").trim()}|${Number(round || 1)}`;
    let hash = 0;

    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) % 9973;
    }

    return {
      leftValue: (hash % 6) + 1,
      rightValue: (Math.floor(hash / 6) % 6) + 1
    };
  },

  decorateCalledStudent(student = {}, round = 0) {
    const name = String(student.name || student.studentName || "").trim();
    const studentId = String(student.studentId || student.id || "").trim();
    const gender = String(student.gender || student.sex || student.studentGender || "").trim();
    return {
      ...student,
      name,
      studentId,
      gender,
      avatarType: this.getAvatarTypeByGender(gender),
      round: Number(round || student.round || 0),
      avatarText: String(name || "学").slice(0, 1)
    };
  },

  clearRollAnimationTimers(options = {}) {
    if (this.rollAnimationTimer) {
      clearInterval(this.rollAnimationTimer);
    }
    if (this.rollAnimationFinishTimer) {
      clearTimeout(this.rollAnimationFinishTimer);
    }
    this.rollAnimationTimer = null;
    this.rollAnimationFinishTimer = null;

    if (!options.keepRollingState) {
      this.setData({ isRolling: false });
    }
  },

  clearDisplayTimers() {
    if (this.verifyDisplayTimer) {
      clearInterval(this.verifyDisplayTimer);
    }
    if (this.countdownDisplayTimer) {
      clearInterval(this.countdownDisplayTimer);
    }
    this.verifyDisplayTimer = null;
    this.countdownDisplayTimer = null;
  },

  formatTwoDigits(value = 0) {
    return String(Math.max(0, Number(value || 0))).padStart(2, "0").slice(-2);
  },

  getVerifyEndsAt(verifyStartedAt = 0) {
    const safeVerifyStartedAt = Number(verifyStartedAt || 0);
    return safeVerifyStartedAt > 0 ? safeVerifyStartedAt + this.verifyDurationMs : 0;
  },

  getVerifyProgressState(verifyStartedAt = 0, verifyEndsAt = 0) {
    const now = Date.now();
    const safeVerifyStartedAt = Number(verifyStartedAt || 0);
    const verifyDurationMs = this.verifyDurationMs;
    const safeVerifyEndsAt = Number(verifyEndsAt || 0) || this.getVerifyEndsAt(safeVerifyStartedAt);
    if (!safeVerifyStartedAt) {
      return {
        verifyStartedAt: 0,
        verifyEndsAt: 0,
        secondsLeft: this.verifyDurationSeconds,
        progressPercent: 100,
        elapsedMs: 0,
        finished: false
      };
    }

    const timelineNow = Math.max(now, safeVerifyStartedAt);
    const elapsedMs = Math.max(0, timelineNow - safeVerifyStartedAt);
    const remainingMs = Math.max(0, safeVerifyEndsAt - timelineNow);
    return {
      verifyStartedAt: safeVerifyStartedAt,
      verifyEndsAt: safeVerifyEndsAt,
      secondsLeft: remainingMs > 0
        ? Math.min(this.verifyDurationSeconds, Math.ceil(remainingMs / 1000))
        : 0,
      progressPercent: Math.max(0, Math.min(100, (1 - (elapsedMs / verifyDurationMs)) * 100)),
      elapsedMs,
      finished: timelineNow >= safeVerifyEndsAt
    };
  },

  resolveVerifyTimeline(student = {}, options = {}) {
    const explicitVerifyStartedAt = Number(options.verifyStartedAt || 0);
    const explicitVerifyEndsAt = Number(options.verifyEndsAt || 0);
    if (explicitVerifyStartedAt > 0) {
      return {
        verifyStartedAt: explicitVerifyStartedAt,
        verifyEndsAt: explicitVerifyEndsAt > 0 ? explicitVerifyEndsAt : this.getVerifyEndsAt(explicitVerifyStartedAt)
      };
    }

    const currentStudentKey = this.getStudentUniqueId(this.data.currentCalledStudent);
    const targetStudentKey = this.getStudentUniqueId(student);
    if (
      targetStudentKey &&
      currentStudentKey &&
      targetStudentKey === currentStudentKey &&
      Number(this.data.verifyStartedAt || 0) > 0
    ) {
      const currentVerifyStartedAt = Number(this.data.verifyStartedAt || 0);
      return {
        verifyStartedAt: currentVerifyStartedAt,
        verifyEndsAt: Number(this.data.verifyEndsAt || 0) || this.getVerifyEndsAt(currentVerifyStartedAt)
      };
    }

    const rollcallStartedAt = Number(options.rollcallStartedAt || options.startedAt || 0);
    if (rollcallStartedAt > 0) {
      const nextVerifyStartedAt = rollcallStartedAt + this.rollingDurationSeconds * 1000;
      return {
        verifyStartedAt: nextVerifyStartedAt,
        verifyEndsAt: this.getVerifyEndsAt(nextVerifyStartedAt)
      };
    }

    const fallbackVerifyStartedAt = Date.now();
    return {
      verifyStartedAt: fallbackVerifyStartedAt,
      verifyEndsAt: this.getVerifyEndsAt(fallbackVerifyStartedAt)
    };
  },

  setIdleDisplayState() {
    this.clearDisplayTimers();
    this.setData({
      displayPhase: "idle",
      displayLeftText: "0",
      displayRightText: "0",
      verifyStartedAt: 0,
      verifyEndsAt: 0,
      verifySecondsLeft: this.verifyDurationSeconds,
      verifyProgressPercent: 100,
      countdownSecondsLeft: this.thinkingDurationSeconds,
      recordSubmitting: false
    });
  },

  shouldRestoreLocalPendingVisual() {
    if (this.data.displayPhase === "idle") {
      return false;
    }

    return !!(
      this.data.pendingScoreLock &&
      this.data.currentCalledStudent &&
      this.getStudentUniqueId(this.data.currentCalledStudent)
    );
  },

  setRollingDisplayState() {
    this.clearDisplayTimers();
    this.setData({
      displayPhase: "rolling",
      displayLeftText: "0",
      displayRightText: "0",
      verifyStartedAt: 0,
      verifyEndsAt: 0,
      verifySecondsLeft: this.verifyDurationSeconds,
      verifyProgressPercent: 100,
      countdownSecondsLeft: this.thinkingDurationSeconds,
      recordSubmitting: false
    });
  },

  setVerifyDisplayState(student = {}, verifyStartedAt = 0, verifyEndsAt = 0) {
    const studentIdText = this.getStudentIdLastTwoDigits(student.studentId || "").displayText;
    const verifyState = this.getVerifyProgressState(verifyStartedAt, verifyEndsAt);
    this.setData({
      displayPhase: "verify",
      displayLeftText: studentIdText.slice(0, 1) || "0",
      displayRightText: studentIdText.slice(1) || "0",
      verifyStartedAt: verifyState.verifyStartedAt,
      verifyEndsAt: verifyState.verifyEndsAt,
      verifySecondsLeft: verifyState.secondsLeft,
      verifyProgressPercent: verifyState.progressPercent
    });
  },

  setCountdownDisplayState(secondsLeft = this.thinkingDurationSeconds) {
    const safeSeconds = Math.max(0, Number(secondsLeft || 0));
    const countdownText = this.formatTwoDigits(safeSeconds);
    const isWarning = safeSeconds > 0 && safeSeconds <= 10;
    const nextPhase = safeSeconds === 0 ? "finished" : (isWarning ? "warning" : "countdown");
    this.setData({
      displayPhase: nextPhase,
      displayLeftText: countdownText.slice(0, 1),
      displayRightText: countdownText.slice(1),
      countdownSecondsLeft: safeSeconds
    });
  },

  startCountdownFlow(verifyEndsAt = 0) {
    const safeVerifyEndsAt = Number(verifyEndsAt || 0);
    const countdownElapsed = Math.max(0, Math.floor((Date.now() - safeVerifyEndsAt) / 1000));
    const countdownSecondsLeft = Math.max(0, this.thinkingDurationSeconds - countdownElapsed);
    this.setCountdownDisplayState(countdownSecondsLeft);

    if (countdownSecondsLeft <= 0) {
      return;
    }

    let runningSecondsLeft = countdownSecondsLeft;
    this.countdownDisplayTimer = setInterval(() => {
      runningSecondsLeft -= 1;
      this.setCountdownDisplayState(runningSecondsLeft);
      if (runningSecondsLeft <= 0) {
        this.clearDisplayTimers();
      }
    }, 1000);
  },

  startDisplayFlow(student = {}, options = {}) {
    if (!student || !student.studentId) {
      this.setIdleDisplayState();
      return;
    }

    this.clearDisplayTimers();
    const normalizedOptions = typeof options === "object" && options !== null
      ? options
      : { rollcallStartedAt: Number(options || 0) };
    const verifyTimeline = this.resolveVerifyTimeline(student, normalizedOptions);
    const verifyState = this.getVerifyProgressState(
      verifyTimeline.verifyStartedAt,
      verifyTimeline.verifyEndsAt
    );

    if (!verifyState.finished) {
      this.setVerifyDisplayState(student, verifyTimeline.verifyStartedAt, verifyTimeline.verifyEndsAt);
      this.verifyDisplayTimer = setInterval(() => {
        const runningVerifyState = this.getVerifyProgressState(
          verifyTimeline.verifyStartedAt,
          verifyTimeline.verifyEndsAt
        );
        if (!runningVerifyState.finished) {
          this.setVerifyDisplayState(student, verifyTimeline.verifyStartedAt, verifyTimeline.verifyEndsAt);
          return;
        }
        this.clearDisplayTimers();
        this.startCountdownFlow(verifyTimeline.verifyEndsAt);
      }, 200);
      return;
    }

    this.startCountdownFlow(verifyTimeline.verifyEndsAt);
  },

  playDiceRollAnimation(finalLeftValue = 1, finalRightValue = 1, studentId = "") {
    this.clearRollAnimationTimers({ keepRollingState: true });
    this.setData({ isRolling: true });

    return new Promise((resolve) => {
      let tickCount = 0;
      const maxTicks = Math.max(1, Math.round((this.rollingDurationSeconds * 1000) / 90));

      this.rollAnimationTimer = setInterval(() => {
        tickCount += 1;
        this.setDiceDisplay(
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1
        );

        if (tickCount < maxTicks) {
          return;
        }

        clearInterval(this.rollAnimationTimer);
        this.rollAnimationTimer = null;
        this.rollAnimationFinishTimer = null;
        const { leftText, rightText } = this.getStudentIdLastTwoDigits(studentId);
        this.setData({
          diceLeftValue: 0,
          diceRightValue: 0,
          diceLeftText: leftText,
          diceRightText: rightText,
          diceTextMode: true,
          leftDicePips: [],
          rightDicePips: [],
          isRolling: false
        });
        resolve();
      }, 90);
    });
  },

  mergeAttendanceIntoList(baseList, docs = []) {
    const attendanceByStudentId = new Map();
    const attendanceByName = new Map();

    docs.forEach((doc) => {
      const studentId = String(doc.studentId || "").trim();
      const studentName = String(doc.studentName || "").trim();

      if (studentId) attendanceByStudentId.set(studentId, doc);
      if (studentName) attendanceByName.set(studentName, doc);
    });

    return baseList.map((item) => {
      const matchedById = item.studentId && attendanceByStudentId.get(item.studentId);
      const matchedByName = item.name && attendanceByName.get(item.name);

      const matchedDoc =
        matchedById ||
        matchedByName;

      if (!matchedDoc) return { ...item };

      const status = String(
        matchedDoc.status ||
        matchedDoc.attendanceStatus ||
        "signed"
      ).trim() || "signed";

      return {
        ...item,
        status,
        statusLabel: this.getSignStatusLabel(status)
      };
    });
  },

  async onLoad(options) {
    if (!(await this.ensureTeacherPageAccess())) return;
    // 从上一页（classHome 或 studentList）传入的参数
    const lessonId = String(options.lessonId || "").trim();
    const classId = String(options.classId || "").trim();

    this.setData({
      lessonId,
      classId,
      selectedLessonId: lessonId
    }, () => {
      this.resetDiceDisplay();
      this.initData();
    });
  },

  async onShow() {
    if (!(await this.ensureTeacherPageAccess())) return;
    if (this.isInitializing) return;
    const didSwitchLesson = await this.syncLessonsAfterReturn();
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId || didSwitchLesson) return;
    if (!this.isWritableCurrentLesson(lessonId, this.getActiveLessonId())) return;

    const attendanceReady = this.attendancePollingLessonId === lessonId && !!this.attendancePollingTimer;
    const lessonEventReady = this.lessonEventPollingLessonId === lessonId && !!this.lessonEventPollingTimer;
    if (attendanceReady && lessonEventReady) return;

    this.fetchAttendanceOnce(lessonId);
    this.startAttendancePolling(lessonId);
    this.loadLessonEvents({ silent: true });
    this.startLessonEventPolling(lessonId);
  },

  onUnload() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
    this.clearRollAnimationTimers();
    this.clearDisplayTimers();
  },

  onHide() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
    this.clearRollAnimationTimers();
    this.clearDisplayTimers();
  },

  async onPullDownRefresh() {
    try {
      const didSwitchLesson = await this.syncLessonsAfterReturn();
      if (didSwitchLesson) return;
      if (this.isWritableCurrentLesson(this.data.selectedLessonId || this.data.lessonId, this.getActiveLessonId())) {
        await this.refreshAttendance();
      }
      await this.loadLessonEvents({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initData() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.setData({
      pageLoading: true,
      pageErrorText: ""
    });
    wx.showLoading({ title: "加载中..." });
    try {
      const [_, lessons] = await Promise.all([
        this.loadRoster(),
        this.loadLessons()
      ]);
      const initialLessonId = this.resolveInitialLessonId(lessons);

      if (initialLessonId) {
        await this.switchLesson(initialLessonId);
      } else {
        const list = this.cloneBaseRosterList();
        this.setData({
          lessonId: "",
          selectedLessonId: "",
          currentLessonLabel: "",
          list,
          currentCalledStudent: null,
          lessonEvents: [],
          displayLessonEvents: [],
          selectedScore: 0,
          lastScoredStudentName: "",
          lastScoredRound: 0
        });
        this.setIdleDisplayState();
        this.refreshSignedStudents();
      }
    } catch (err) {
      console.error("[randomRollcall] initData failed", err);
      this.setData({
        pageErrorText: "随机点名初始化失败，请重新加载。"
      });
    } finally {
      this.isInitializing = false;
      this.setData({
        pageLoading: false
      });
      wx.hideLoading();
    }
  },

  retryPageLoad() {
    this.initData();
  },

  refreshSignedStudents() {
    const list = Array.isArray(this.data.list) ? this.data.list : [];
    const signedStudents = list
      .filter((item) => item.status === "signed")
      .map((item) => ({
        studentId: String(item.studentId || item.id || "").trim(),
        name: String(item.name || item.studentName || "").trim(),
        gender: String(item.gender || item.sex || item.studentGender || "").trim()
      }))
      .filter((item) => item.name);

    this.setData({
      signedStudents,
      lessonSignedCount: signedStudents.length
    });
    this.rebuildLessonStats({
      signedStudents
    });
    return signedStudents;
  },

  getRandomSignedStudent() {
    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    if (signedStudents.length === 0) return null;
    const index = Math.floor(Math.random() * signedStudents.length);
    return signedStudents[index] || null;
  },

  getStudentUniqueId(student = {}) {
    if (!student || typeof student !== "object") {
      return "";
    }

    const studentId = String(student.studentId || student.id || "").trim();
    const studentName = String(student.name || student.studentName || "").trim();
    const openid = String(student.openid || student._openid || "").trim();

    if (studentId && studentName) {
      return `${studentId}::${studentName}`;
    }

    return String(
      studentId ||
      openid ||
      studentName ||
      ""
    ).trim();
  },

  getWeightedCandidates(candidateList = []) {
    return candidateList;
  },

  getRosterStudentKeySet() {
    return new Set(
      (this.data.baseRosterList || [])
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );
  },

  getRoundCalledStudentKeySet(round = 0, lessonEvents = []) {
    const targetRound = Number(round || 0);
    if (!targetRound) return new Set();

    return new Set(
      (lessonEvents || [])
        .filter((item) => item && item.type === "rollcall" && Number(item.round || 0) === targetRound)
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );
  },

  getRoundProgress(round = 0, lessonEvents = []) {
    const rosterStudentKeySet = this.getRosterStudentKeySet();
    const roundCalledStudentKeySet = this.getRoundCalledStudentKeySet(round, lessonEvents);
    const totalCount = rosterStudentKeySet.size || roundCalledStudentKeySet.size;
    const progressCount = rosterStudentKeySet.size > 0
      ? Array.from(rosterStudentKeySet).filter((key) => roundCalledStudentKeySet.has(key)).length
      : roundCalledStudentKeySet.size;

    return {
      progressCount,
      totalCount
    };
  },

  getLessonCalledStudentKeySet(lessonEvents = [], options = {}) {
    const lessonCalledStudentKeySet = new Set(
      (lessonEvents || [])
        .filter((item) => item && item.type === "rollcall")
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );

    if (options.includePendingCurrent && this.data.currentCalledStudent) {
      const currentStudentKey = this.getStudentUniqueId(this.data.currentCalledStudent);
      if (currentStudentKey) {
        lessonCalledStudentKeySet.add(currentStudentKey);
      }
    }

    return lessonCalledStudentKeySet;
  },

  rebuildLessonStats(options = {}) {
    const lessonEvents = Array.isArray(options.lessonEvents)
      ? options.lessonEvents
      : this.data.lessonEvents;
    const signedStudents = Array.isArray(options.signedStudents)
      ? options.signedStudents
      : this.data.signedStudents;
    const lessonCalledCount = this.getLessonCalledStudentKeySet(lessonEvents, {
      includePendingCurrent: !!options.includePendingCurrent
    }).size;
    const lessonSignedCount = Array.isArray(signedStudents) ? signedStudents.length : 0;

    if (
      lessonCalledCount === Number(this.data.lessonCalledCount || 0) &&
      lessonSignedCount === Number(this.data.lessonSignedCount || 0)
    ) {
      return;
    }

    this.setData({
      lessonCalledCount,
      lessonSignedCount
    });
  },

  isRoundComplete(round = 0, lessonEvents = []) {
    const rosterStudentKeySet = this.getRosterStudentKeySet();
    const roundCalledStudentKeySet = this.getRoundCalledStudentKeySet(round, lessonEvents);

    if (rosterStudentKeySet.size === 0) {
      return roundCalledStudentKeySet.size > 0;
    }

    return Array.from(rosterStudentKeySet).every((key) => roundCalledStudentKeySet.has(key));
  },

  getLessonEventTypeLabel(type) {
    const map = {
      rollcall: "随机点名",
      answer_score: "回答得分",
      test_publish: "测试发布",
      test_record: "随堂测试"
    };
    return map[type] || type;
  },

  isRollcallRelatedLessonEvent(item = {}) {
    if (!item || typeof item !== "object") return false;
    const type = String(item.type || "").trim();
    return type === "rollcall" || type === "answer_score";
  },

  getLessonEventsSignature(lessonEvents = []) {
    return JSON.stringify(
      (lessonEvents || []).map((item) => ({
        _id: String(item._id || ""),
        type: String(item.type || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        score: item.score ?? "",
        round: Number(item.round || 0),
        displayTime: String(item.displayTime || "")
      }))
    );
  },

  getClassRollcallEventsSignature(lessonEvents = []) {
    return this.getLessonEventsSignature(lessonEvents);
  },

  getActiveLessonId(lessons = this.data.lessons) {
    return String(
      (lessons || []).find((item) => String(item?.status || "").trim() === "active")?._id || ""
    ).trim();
  },

  normalizeLessons(lessons = []) {
    const total = Array.isArray(lessons) ? lessons.length : 0;
    return (lessons || []).map((item, index) => ({
      ...item,
      orderLabel: `第${total - index}次课`
    }));
  },

  getLessonOrderLabel(lessonId = "", lessons = this.data.lessons) {
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return "";

    const matchedLesson = (lessons || []).find(
      (item) => String(item?._id || item?.lessonId || "").trim() === targetLessonId
    );

    return String(matchedLesson?.orderLabel || "").trim();
  },

  getDisplayLessonEvents(lessonEvents = []) {
    return (lessonEvents || []).filter(
      (item) => String(item.type || "").trim() === "answer_score"
        && item.score !== ""
        && item.score !== null
        && item.score !== undefined
    );
  },

  isWritableCurrentLesson(lessonId = "", activeLessonId = this.getActiveLessonId()) {
    const targetLessonId = String(lessonId || "").trim();
    const currentActiveLessonId = String(activeLessonId || "").trim();
    return !!targetLessonId && !!currentActiveLessonId && targetLessonId === currentActiveLessonId;
  },

  async queryLessonEventList(where = {}) {
    const pageSize = 100;
    let skip = 0;
    let hasMore = true;
    const list = [];

    while (hasMore) {
      const res = await db.collection("lessonEvent")
        .where(where)
        .orderBy("createdAt", "desc")
        .skip(skip)
        .limit(pageSize)
        .get();
      const pageList = Array.isArray(res.data) ? res.data : [];
      list.push(...pageList);
      hasMore = pageList.length === pageSize;
      skip += pageList.length;
    }

    return list;
  },

  getAttendanceListSignature(list = []) {
    return JSON.stringify(
      (list || []).map((item) => ({
        studentId: String(item.studentId || item.id || "").trim(),
        name: String(item.name || item.studentName || "").trim(),
        status: String(item.status || "").trim(),
        statusLabel: String(item.statusLabel || "").trim(),
        attendanceScoreText: String(item.attendanceScoreText || "").trim(),
        answerScoreText: String(item.answerScoreText || "").trim(),
        answerScoreAvgText: String(item.answerScoreAvgText || "").trim(),
        questionScoreText: String(item.questionScoreText || "").trim(),
        questionScoreAvgText: String(item.questionScoreAvgText || "").trim(),
        testScoreText: String(item.testScoreText || "").trim(),
        testScoreAvgText: String(item.testScoreAvgText || "").trim(),
        lessonScoreText: String(item.lessonScoreText || "").trim(),
        lessonScoreBreakdownText: String(item.lessonScoreBreakdownText || "").trim()
      }))
    );
  },

  parseScore(value) {
    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }

    const score = Number(value);
    return Number.isFinite(score) ? score : null;
  },

  formatScore(value) {
    if (!Number.isFinite(value)) return "";
    const fixedScore = Math.round(value * 100) / 100;
    return Number.isInteger(fixedScore)
      ? String(fixedScore)
      : fixedScore.toFixed(2).replace(/\.?0+$/, "");
  },

  getAverageScore(scoreList = []) {
    const validScores = (scoreList || []).filter((score) => Number.isFinite(score));
    if (validScores.length === 0) return null;
    const total = validScores.reduce((sum, score) => sum + score, 0);
    return Math.round((total / validScores.length) * 100) / 100;
  },

  buildLessonScoreDetail(status = "", options = {}) {
    const normalizedStatus = String(status || "").trim();
    const answerScoreAvg = Number.isFinite(options.answerScoreAvg) ? options.answerScoreAvg : null;
    const questionScoreAvg = Number.isFinite(options.questionScoreAvg) ? options.questionScoreAvg : null;
    const testScoreAvg = Number.isFinite(options.testScoreAvg) ? options.testScoreAvg : null;

    if (normalizedStatus === "leave_agree") {
      return {
        attendanceScore: 60,
        attendanceScoreText: "60",
        lessonScore: 60,
        lessonScoreText: "60",
        lessonScoreBreakdownText: "请假60",
        lessonScoreApplicableItems: [
          { key: "attendance_leave", label: "请假", score: 60 }
        ]
      };
    }

    if (normalizedStatus === "absent") {
      return {
        attendanceScore: 0,
        attendanceScoreText: "0",
        lessonScore: 0,
        lessonScoreText: "0",
        lessonScoreBreakdownText: "旷课0",
        lessonScoreApplicableItems: [
          { key: "attendance_absent", label: "旷课", score: 0 }
        ]
      };
    }

    const applicableItems = [];
    if (normalizedStatus === "signed") {
      applicableItems.push({
        key: "attendance_present",
        label: "到课",
        score: 80
      });
    }
    if (Number.isFinite(answerScoreAvg)) {
      applicableItems.push({
        key: "rollcall",
        label: "随机点名",
        score: answerScoreAvg
      });
    }
    if (Number.isFinite(questionScoreAvg)) {
      applicableItems.push({
        key: "question",
        label: "主动提问",
        score: questionScoreAvg
      });
    }
    if (Number.isFinite(testScoreAvg)) {
      applicableItems.push({
        key: "test",
        label: "随堂测试",
        score: testScoreAvg
      });
    }

    if (applicableItems.length === 0) {
      return {
        attendanceScore: normalizedStatus === "signed" ? 80 : null,
        attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
        lessonScore: null,
        lessonScoreText: "",
        lessonScoreBreakdownText: "",
        lessonScoreApplicableItems: []
      };
    }

    const lessonScore = this.getAverageScore(applicableItems.map((item) => item.score));

    return {
      attendanceScore: normalizedStatus === "signed" ? 80 : null,
      attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
      lessonScore,
      lessonScoreText: this.formatScore(lessonScore),
      lessonScoreBreakdownText: applicableItems
        .map((item) => `${item.label}${this.formatScore(item.score)}`)
        .join(" / "),
      lessonScoreApplicableItems: applicableItems
    };
  },

  buildInteractionScoreMap(lessonEvents = []) {
    const interactionScoreMap = new Map();
    const scoreEvents = (lessonEvents || []).filter(
      (item) =>
        item.type === "answer_score" ||
        item.type === "question_score" ||
        item.type === "test_record"
    );

    scoreEvents.forEach((item) => {
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;

      if (!interactionScoreMap.has(studentKey)) {
        interactionScoreMap.set(studentKey, {
          answerScores: [],
          questionScores: [],
          testScores: []
        });
      }

      const score = this.parseScore(item.score);
      if (!Number.isFinite(score)) return;

      const target = interactionScoreMap.get(studentKey);
      if (item.type === "answer_score") {
        target.answerScores.push(score);
        return;
      }

      if (item.type === "test_record") {
        target.testScores.push(score);
        return;
      }

      target.questionScores.push(score);
    });

    return interactionScoreMap;
  },

  mergeInteractionIntoList(baseList, lessonEvents = []) {
    const interactionScoreMap = this.buildInteractionScoreMap(lessonEvents);

    return (baseList || []).map((item) => {
      const studentKey = this.getStudentUniqueId(item);
      const interaction = interactionScoreMap.get(studentKey) || {
        answerScores: [],
        questionScores: [],
        testScores: []
      };
      const answerScoreAvg = this.getAverageScore(interaction.answerScores);
      const questionScoreAvg = this.getAverageScore(interaction.questionScores);
      const testScoreAvg = this.getAverageScore(interaction.testScores);
      const lessonScoreDetail = this.buildLessonScoreDetail(item.status, {
        answerScoreAvg,
        questionScoreAvg,
        testScoreAvg
      });

      return {
        ...item,
        answerScoreText: interaction.answerScores.join(" / "),
        answerScoreAvg,
        answerScoreAvgText: this.formatScore(answerScoreAvg),
        questionScoreText: interaction.questionScores.join(" / "),
        questionScoreAvg,
        questionScoreAvgText: this.formatScore(questionScoreAvg),
        testScoreText: interaction.testScores.join(" / "),
        testScoreAvg,
        testScoreAvgText: this.formatScore(testScoreAvg),
        attendanceScore: lessonScoreDetail.attendanceScore,
        attendanceScoreText: lessonScoreDetail.attendanceScoreText,
        lessonScore: lessonScoreDetail.lessonScore,
        lessonScoreText: lessonScoreDetail.lessonScoreText,
        lessonScoreBreakdownText: lessonScoreDetail.lessonScoreBreakdownText,
        lessonScoreApplicableItems: lessonScoreDetail.lessonScoreApplicableItems
      };
    });
  },

  getSignStatusLabel(status) {
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "已请假"
    };
    return map[status] || "未签到";
  },

  rebuildStudentDisplayList(options = {}) {
    const attendanceDocs = Array.isArray(options.attendanceDocs)
      ? options.attendanceDocs
      : this.latestAttendanceDocs;
    const lessonEvents = Array.isArray(options.lessonEvents)
      ? options.lessonEvents
      : this.data.lessonEvents;
    const baseList = this.cloneBaseRosterList();
    const attendanceMergedList = this.mergeAttendanceIntoList(baseList, attendanceDocs);
    const list = this.mergeInteractionIntoList(attendanceMergedList, lessonEvents);
    const nextSignature = this.getAttendanceListSignature(list);
    const currentSignature = this.getAttendanceListSignature(this.data.list);

    if (nextSignature === currentSignature) {
      return list;
    }

    this.setData({ list });
    this.refreshSignedStudents();
    return list;
  },

  normalizeLessonEvent(item = {}) {
    if (!item || typeof item !== "object") {
      return {
        _id: "",
        lessonId: "",
        classId: "",
        studentId: "",
        studentName: "",
        type: "",
        score: "",
        round: 0,
        payload: {},
        displayType: "",
        displayTime: ""
      };
    }

    const payload = item.payload || {};
    const testType = String(payload.testType || "").trim();
    const testSubType = String(payload.testSubType || "").trim();
    const testResult = String(payload.result || "").trim();
    const testStatus = String(payload.status || "").trim();
    const testContent = String(payload.content || "").trim();
    const testAnswer = String(payload.answer || "").trim();
    const testQuestionId = String(payload.questionId || item._id || "").trim();
    const testOptions = Array.isArray(payload.options)
      ? payload.options.map((option) => String(option || "").trim()).filter(Boolean)
      : [];
    const testCorrectAnswer = String(payload.correctAnswer || "").trim();

    return {
      ...item,
      _id: String(item._id || "").trim(),
      lessonId: String(item.lessonId || "").trim(),
      classId: String(item.classId || "").trim(),
      studentId: String(item.studentId || "").trim(),
      studentName: String(item.studentName || "").trim(),
      type: String(item.type || "").trim(),
      score: item.score ?? "",
      round: Number(item.round || 0),
      testType,
      testSubType,
      testResult,
      testStatus,
      testContent,
      testAnswer,
      testQuestionId,
      testOptions,
      testOptionsText: testOptions.join(" / "),
      testCorrectAnswer,
      testSummary: item.type === "test_record" || item.type === "test_publish"
        ? [testType, testSubType, testResult, testStatus].filter(Boolean).join(" / ")
        : "",
      displayType: this.getLessonEventTypeLabel(item.type),
      displayTime: this.formatSimpleDateTime(item.createdAt)
    };
  },

  getEventTimestamp(item = {}) {
    const createdAt = item?.createdAt;
    if (!createdAt) return 0;

    if (createdAt instanceof Date) {
      return createdAt.getTime();
    }

    if (typeof createdAt?.toDate === "function") {
      const date = createdAt.toDate();
      return date instanceof Date ? date.getTime() : 0;
    }

    const timestamp = new Date(createdAt).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  },

  getRollcallScoreKey(item = {}) {
    const round = Number(item.round || 0);
    const studentKey = this.getStudentUniqueId(item);
    if (!round || !studentKey) return "";
    return `${round}::${studentKey}`;
  },

  async queryAttendanceList(where = {}) {
    const pageSize = 100;
    let skip = 0;
    let hasMore = true;
    const list = [];

    while (hasMore) {
      const res = await db.collection("attendance")
        .where(where)
        .skip(skip)
        .limit(pageSize)
        .get();
      const pageList = Array.isArray(res.data) ? res.data : [];
      list.push(...pageList);
      hasMore = pageList.length === pageSize;
      skip += pageList.length;
    }

    return list;
  },

  getPreviousLessonId(lessonId = "") {
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return "";

    const lessons = Array.isArray(this.data.lessons) ? this.data.lessons : [];
    const index = lessons.findIndex((item) => String(item?._id || "").trim() === targetLessonId);
    if (index < 0 || index >= lessons.length - 1) {
      return "";
    }

    return String(lessons[index + 1]?._id || "").trim();
  },

  buildAttendanceStatusMap(attendanceDocs = []) {
    const map = new Map();

    (attendanceDocs || []).forEach((item) => {
      const studentId = String(item.studentId || "").trim();
      const studentName = String(item.studentName || item.name || "").trim();
      const status = String(item.status || item.attendanceStatus || "unsigned").trim() || "unsigned";

      if (studentId) {
        map.set(studentId, status);
      }
      if (studentName && !map.has(studentName)) {
        map.set(studentName, status);
      }
    });

    return map;
  },

  async buildContinuationContext(round = 0, candidateList = []) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const previousLessonId = this.getPreviousLessonId(lessonId);
    const normalizedRound = Number(round || 0);

    if (!lessonId || !previousLessonId || !normalizedRound || !Array.isArray(candidateList) || candidateList.length === 0) {
      return null;
    }

    const previousRoundEvents = (this.latestClassRollcallEvents || []).filter(
      (item) =>
        item.type === "rollcall" &&
        String(item.lessonId || "").trim() === previousLessonId &&
        Number(item.round || 0) === normalizedRound
    );

    if (previousRoundEvents.length === 0) {
      return null;
    }

    const continuationContextCache = this.continuationContextCache || {};
    const cachedContext = continuationContextCache[previousLessonId];
    if (cachedContext) {
      return {
        previousLessonId,
        previousCalledSet: new Set(
          previousRoundEvents
            .map((item) => this.getStudentUniqueId(item))
            .filter(Boolean)
        ),
        previousAttendanceStatusMap: cachedContext.previousAttendanceStatusMap || new Map()
      };
    }

    try {
      const previousAttendanceDocs = await this.queryAttendanceList({ lessonId: previousLessonId });
      const previousAttendanceStatusMap = this.buildAttendanceStatusMap(previousAttendanceDocs);
      this.continuationContextCache = {
        ...continuationContextCache,
        [previousLessonId]: {
          previousAttendanceStatusMap
        }
      };
      return {
        previousLessonId,
        previousCalledSet: new Set(
          previousRoundEvents
            .map((item) => this.getStudentUniqueId(item))
            .filter(Boolean)
        ),
        previousAttendanceStatusMap
      };
    } catch (err) {
      console.error("[randomRollcall] buildContinuationContext failed", {
        previousLessonId,
        round: normalizedRound,
        err
      });
      return {
        previousLessonId,
        previousCalledSet: new Set(
          previousRoundEvents
            .map((item) => this.getStudentUniqueId(item))
            .filter(Boolean)
        ),
        previousAttendanceStatusMap: new Map()
      };
    }
  },

  pickWeightedGroup(groups = []) {
    const availableGroups = (groups || []).filter((group) => Array.isArray(group.list) && group.list.length > 0 && Number(group.weight || 0) > 0);
    if (availableGroups.length === 0) return null;

    const totalWeight = availableGroups.reduce((sum, group) => sum + Number(group.weight || 0), 0);
    let cursor = Math.random() * totalWeight;

    for (let i = 0; i < availableGroups.length; i += 1) {
      cursor -= Number(availableGroups[i].weight || 0);
      if (cursor <= 0) {
        return availableGroups[i];
      }
    }

    return availableGroups[availableGroups.length - 1] || null;
  },

  getWeightedCandidateGroups(candidateList = [], continuationContext = null) {
    if (!continuationContext) {
      return {
        selectedGroupKey: "default",
        groups: [
          {
            key: "default",
            weight: 100,
            list: candidateList
          }
        ]
      };
    }

    const previousCalledSet = continuationContext.previousCalledSet || new Set();
    const previousAttendanceStatusMap = continuationContext.previousAttendanceStatusMap || new Map();
    const groups = {
      A: [],
      B: [],
      C: []
    };

    (candidateList || []).forEach((student) => {
      const studentKey = this.getStudentUniqueId(student);
      const previousStatus = String(
        previousAttendanceStatusMap.get(studentKey) ||
        previousAttendanceStatusMap.get(String(student.name || "").trim()) ||
        ""
      ).trim();
      const wasPreviousLeaveOrAbsent = previousStatus === "absent" || previousStatus === "leave_agree";
      const wasCalledInPreviousLesson = previousCalledSet.has(studentKey);

      if (wasPreviousLeaveOrAbsent) {
        groups.A.push(student);
        return;
      }

      if (wasCalledInPreviousLesson) {
        groups.C.push(student);
        return;
      }

      groups.B.push(student);
    });

    const groupList = [
      { key: "A", weight: 50, list: groups.A },
      { key: "B", weight: 35, list: groups.B },
      { key: "C", weight: 15, list: groups.C }
    ];
    const selectedGroup = this.pickWeightedGroup(groupList);

    return {
      selectedGroupKey: selectedGroup?.key || "default",
      groups: groupList
    };
  },

  pickStudentFromWeightedGroups(groupResult = null) {
    const groups = Array.isArray(groupResult?.groups) ? groupResult.groups : [];
    const targetGroup = groups.find((item) => item.key === groupResult?.selectedGroupKey && Array.isArray(item.list) && item.list.length > 0)
      || this.pickWeightedGroup(groups)
      || null;

    if (!targetGroup || !Array.isArray(targetGroup.list) || targetGroup.list.length === 0) {
      return null;
    }

    const index = Math.floor(Math.random() * targetGroup.list.length);
    return targetGroup.list[index] || null;
  },

  rememberRecentAnswerScore(item = {}) {
    const scoreKey = this.getRollcallScoreKey(item);
    if (!scoreKey) return;

    if (!(this.recentAnswerScoreKeys instanceof Set)) {
      this.recentAnswerScoreKeys = new Set();
    }

    this.recentAnswerScoreKeys.add(scoreKey);
  },

  clearRecentAnswerScoreKeys() {
    this.recentAnswerScoreKeys = new Set();
  },

  buildPendingRollcallShadowEvent(student = {}, round = 0) {
    const targetRound = Number(round || student.round || this.data.currentRound || 1);
    return {
      type: "rollcall",
      round: targetRound,
      studentId: String(student.studentId || "").trim(),
      studentName: String(student.name || student.studentName || "").trim()
    };
  },

  rebuildRollcallState(lessonEvents = []) {
    const rollcallSource = Array.isArray(lessonEvents) && lessonEvents.length > 0
      ? lessonEvents
      : this.latestClassRollcallEvents;
    const rollcallEvents = (rollcallSource || [])
      .filter((item) => item && item.type === "rollcall")
      .sort((a, b) => this.getEventTimestamp(a) - this.getEventTimestamp(b));
    const scoreEventKeys = (rollcallSource || [])
      .filter((item) => item && item.type === "answer_score")
      .map((item) => this.getRollcallScoreKey(item))
      .filter(Boolean);
    const recentAnswerScoreKeys = this.recentAnswerScoreKeys instanceof Set
      ? Array.from(this.recentAnswerScoreKeys)
      : [];
    const scoredRollcallKeySet = new Set(
      [
        ...scoreEventKeys,
        ...recentAnswerScoreKeys
      ]
    );

    if (recentAnswerScoreKeys.length > 0 && scoreEventKeys.length > 0) {
      scoreEventKeys.forEach((key) => {
        if (this.recentAnswerScoreKeys instanceof Set) {
          this.recentAnswerScoreKeys.delete(key);
        }
      });
    }

    const roundCalledMap = new Map();
    let maxRound = 0;

    rollcallEvents.forEach((item) => {
      const round = Number(item.round || 1);
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;
      maxRound = Math.max(maxRound, round);
      if (!roundCalledMap.has(round)) {
        roundCalledMap.set(round, new Set());
      }
      roundCalledMap.get(round).add(studentKey);
    });

    const activeRound = maxRound || 1;
    const activeCalledSet = roundCalledMap.get(activeRound) || new Set();
    const currentRoundCalledIds = Array.from(activeCalledSet);
    const pendingRollcallEvents = rollcallEvents.filter((item) => !scoredRollcallKeySet.has(this.getRollcallScoreKey(item)));
    const latestPendingRollcall = pendingRollcallEvents[pendingRollcallEvents.length - 1] || null;
    const hasPendingRollcall = !!latestPendingRollcall;
    const pendingRollcallRound = latestPendingRollcall
      ? Number(latestPendingRollcall.round || activeRound || 1)
      : 0;
    const currentCalledStudent = hasPendingRollcall
      ? this.decorateCalledStudent({
        _id: String(latestPendingRollcall._id || "").trim(),
        studentId: String(latestPendingRollcall.studentId || "").trim(),
        name: String(latestPendingRollcall.studentName || "").trim(),
        createdAt: latestPendingRollcall.createdAt
      }, pendingRollcallRound)
      : null;
    const pendingScoreLock = hasPendingRollcall;
    const roundComplete = this.isRoundComplete(activeRound, rollcallSource);
    const roundProgress = this.getRoundProgress(
      hasPendingRollcall ? (pendingRollcallRound || activeRound) : activeRound,
      rollcallSource
    );
    const localPendingStudent = this.shouldRestoreLocalPendingVisual()
      ? this.decorateCalledStudent(this.data.currentCalledStudent, this.data.currentCalledStudent.round || this.data.currentRound || activeRound || 1)
      : null;
    const shouldKeepLocalPending = !hasPendingRollcall && !!localPendingStudent;
    const isSamePendingStudentAsCurrent = !!(
      currentCalledStudent &&
      this.data.currentCalledStudent &&
      this.getStudentUniqueId(currentCalledStudent) === this.getStudentUniqueId(this.data.currentCalledStudent)
    );
    const preservedSelectedScore = isSamePendingStudentAsCurrent
      ? Number(this.data.selectedScore || 0)
      : 0;

    if (hasPendingRollcall) {
      const pendingVerifyTimeline = this.resolveVerifyTimeline(currentCalledStudent, {
        rollcallStartedAt: this.getEventTimestamp(latestPendingRollcall) || Date.now()
      });
      if (
        this.data.isRolling &&
        this.data.currentCalledStudent &&
        this.getStudentUniqueId(this.data.currentCalledStudent) === this.getStudentUniqueId(currentCalledStudent)
      ) {
        this.setData({
          currentRound: pendingRollcallRound || activeRound,
          currentRoundCalledIds,
          currentRoundProgressCount: roundProgress.progressCount,
          currentRoundTotalCount: roundProgress.totalCount,
          pendingScoreLock,
          currentCalledStudent,
          displayPhase: "rolling",
          selectedScore: preservedSelectedScore
        });
        return;
      }

      this.setData({
        currentRound: pendingRollcallRound || activeRound,
        currentRoundCalledIds,
        currentRoundProgressCount: roundProgress.progressCount,
        currentRoundTotalCount: roundProgress.totalCount,
        pendingScoreLock,
        currentCalledStudent,
        selectedScore: preservedSelectedScore
      });
      this.startDisplayFlow(currentCalledStudent, isSamePendingStudentAsCurrent
        ? {
          verifyStartedAt: Number(this.data.verifyStartedAt || 0) || pendingVerifyTimeline.verifyStartedAt,
          verifyEndsAt: Number(this.data.verifyEndsAt || 0) || pendingVerifyTimeline.verifyEndsAt
        }
        : pendingVerifyTimeline);
      return;
    }

    if (shouldKeepLocalPending) {
      const localRound = Number(localPendingStudent.round || this.data.currentRound || activeRound || 1);
      const shadowRollcallSource = [
        ...(rollcallSource || []),
        this.buildPendingRollcallShadowEvent(localPendingStudent, localRound)
      ];
      const localRoundProgress = this.getRoundProgress(localRound, shadowRollcallSource);
      const localRoundCalledIds = Array.from(new Set([
        ...currentRoundCalledIds,
        this.getStudentUniqueId(localPendingStudent)
      ]));

      this.setNumberCardFinalDisplay(localPendingStudent.studentId);
      this.setData({
        currentRound: localRound,
        currentRoundCalledIds: localRoundCalledIds,
        currentRoundProgressCount: localRoundProgress.progressCount,
        currentRoundTotalCount: localRoundProgress.totalCount,
        pendingScoreLock: true,
        currentCalledStudent: localPendingStudent,
        selectedScore: Number(this.data.selectedScore || 0)
      });
      this.startDisplayFlow(localPendingStudent, {
        verifyStartedAt: Number(this.data.verifyStartedAt || 0),
        verifyEndsAt: Number(this.data.verifyEndsAt || 0)
      });
      return;
    }

    if (roundComplete) {
      this.resetDiceDisplay();
      this.setIdleDisplayState();
      this.setData({
        currentRound: activeRound + 1,
        currentRoundCalledIds: [],
        currentRoundProgressCount: 0,
        currentRoundTotalCount: roundProgress.totalCount,
        pendingScoreLock,
        currentCalledStudent,
        selectedScore: 0
      });
      return;
    }

    this.resetDiceDisplay();
    this.setIdleDisplayState();
    this.setData({
      currentRound: activeRound,
      currentRoundCalledIds,
      currentRoundProgressCount: roundProgress.progressCount,
      currentRoundTotalCount: roundProgress.totalCount,
      pendingScoreLock,
      currentCalledStudent,
      selectedScore: 0
    });
  },

  async loadClassRollcallProgressEvents() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) {
      this.latestClassRollcallEvents = [];
      this.rebuildRollcallState([]);
      return [];
    }

    try {
      const rawEvents = await this.queryLessonEventList({
        classId,
        type: _.in(ROLLCALL_EVENT_TYPES)
      });
      const classRollcallEvents = (rawEvents || [])
        .map((item) => this.normalizeLessonEvent(item))
        .filter((item) => this.isRollcallRelatedLessonEvent(item));
      const nextSignature = this.getClassRollcallEventsSignature(classRollcallEvents);
      const currentSignature = this.getClassRollcallEventsSignature(this.latestClassRollcallEvents);

      if (nextSignature === currentSignature) {
        this.rebuildRollcallState(this.latestClassRollcallEvents);
        return this.latestClassRollcallEvents;
      }

      this.latestClassRollcallEvents = classRollcallEvents;
      this.rebuildRollcallState(classRollcallEvents);
      return classRollcallEvents;
    } catch (err) {
      console.error("[signRecord] loadClassRollcallProgressEvents failed", {
        classId,
        err
      });
      if (this.data.pendingScoreLock && this.data.currentCalledStudent) {
        return this.latestClassRollcallEvents;
      }
      this.latestClassRollcallEvents = [];
      this.rebuildRollcallState([]);
      return [];
    }
  },

  async loadLessonEvents(options = {}) {
    const { silent = false, deferClassProgress = false } = options;
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      this.setData({
        lessonEvents: [],
        displayLessonEvents: [],
        lessonEventsLoading: false
      });
      this.rebuildLessonStats({ lessonEvents: [] });
      if (deferClassProgress) {
        this.loadClassRollcallProgressEvents();
      } else {
        await this.loadClassRollcallProgressEvents();
      }
      return [];
    }

    if (!silent) {
      this.setData({ lessonEventsLoading: true });
    }
    try {
      const rawEvents = await this.queryLessonEventList({
        lessonId,
        type: _.in(ROLLCALL_EVENT_TYPES)
      });
      const lessonEvents = (rawEvents || [])
        .map((item) => this.normalizeLessonEvent(item))
        .filter((item) => this.isRollcallRelatedLessonEvent(item));
      const displayLessonEvents = this.getDisplayLessonEvents(lessonEvents);
      const nextSignature = this.getLessonEventsSignature(lessonEvents);
      const currentSignature = this.getLessonEventsSignature(this.data.lessonEvents);
      if (nextSignature === currentSignature) {
        this.rebuildLessonStats({ lessonEvents: this.data.lessonEvents });
        if (deferClassProgress) {
          this.loadClassRollcallProgressEvents();
        } else {
          await this.loadClassRollcallProgressEvents();
        }
        return this.data.lessonEvents;
      }
      this.setData({
        lessonEvents,
        displayLessonEvents
      });
      this.rebuildStudentDisplayList({ lessonEvents });
      this.rebuildLessonStats({ lessonEvents });
      if (deferClassProgress) {
        this.loadClassRollcallProgressEvents();
      } else {
        await this.loadClassRollcallProgressEvents();
      }
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadLessonEvents failed", err);
      if (this.data.lessonEvents.length > 0) {
        this.setData({
          lessonEvents: [],
          displayLessonEvents: []
        });
      }
      this.rebuildStudentDisplayList({ lessonEvents: [] });
      this.rebuildLessonStats({ lessonEvents: [] });
      if (deferClassProgress) {
        this.loadClassRollcallProgressEvents();
      } else {
        await this.loadClassRollcallProgressEvents();
      }
      return [];
    } finally {
      if (!silent) {
        this.setData({ lessonEventsLoading: false });
      }
    }
  },

  async refreshInteractionDataAfterLessonChange(options = {}) {
    const { shouldLoadLessonEvents = true } = options;
    this.refreshSignedStudents();
    this.clearRecentAnswerScoreKeys();
    this.latestAttendanceDocs = [];
    this.continuationContextCache = {};
    this.setIdleDisplayState();
    this.setData({
      currentCalledStudent: null,
      lessonEvents: [],
      pendingScoreLock: false,
      selectedScore: 0,
      currentRoundProgressCount: 0,
      currentRoundTotalCount: this.getRosterStudentKeySet().size || 0,
      lessonCalledCount: 0,
      lastScoredStudentName: "",
      lastScoredRound: 0
    });
    if (shouldLoadLessonEvents) {
      await this.loadLessonEvents();
    }
  },

  async createLessonEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const currentManagedLessonId = this.getActiveLessonId();

    if (!lessonId || !classId || !this.isWritableCurrentLesson(lessonId, currentManagedLessonId)) {
      wx.showToast({
        title: currentManagedLessonId ? "请切换到当前课次后再点名" : "当前无进行中的课次",
        icon: "none"
      });
      return false;
    }

    try {
      const res = await db.collection("lessonEvent").add({
        data: {
          lessonId,
          classId,
          studentId: String(eventData.studentId || "").trim(),
          studentName: String(eventData.studentName || "").trim(),
          type: String(eventData.type || "").trim(),
          score: Number(eventData.score || 0),
          round: Number(eventData.round || 0),
          payload: eventData.payload || {},
          createdAt: db.serverDate(),
          createdBy: "teacher"
        }
      });
      return String(res?._id || "").trim() || true;
    } catch (err) {
      console.error("[signRecord] createLessonEvent failed", err);
      wx.showToast({
        title: "互动记录失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async saveAnswerScoreEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const currentManagedLessonId = this.getActiveLessonId();
    const targetRound = Number(eventData.round || this.data.currentRound || 0);
    const targetStudentKey = this.getStudentUniqueId(eventData);

    if (!lessonId || !classId || !targetRound || !targetStudentKey || !this.isWritableCurrentLesson(lessonId, currentManagedLessonId)) {
      wx.showToast({
        title: currentManagedLessonId ? "历史课次仅支持查看" : "当前无进行中的课次",
        icon: "none"
      });
      return false;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          classId,
          lessonId,
          type: "answer_score",
          round: targetRound
        })
        .get();

      const existed = (res.data || []).find(
        (item) => this.getStudentUniqueId(item) === targetStudentKey
      );
      const payload = {
        studentId: String(eventData.studentId || "").trim(),
        studentName: String(eventData.studentName || "").trim(),
        score: Number(eventData.score || 0),
        payload: eventData.payload || {},
        createdAt: db.serverDate(),
        createdBy: "teacher"
      };

      if (existed && existed._id) {
        await db.collection("lessonEvent").doc(existed._id).update({
          data: payload
        });
        return true;
      }

      return this.createLessonEvent({
        ...eventData,
        round: targetRound
      });
    } catch (err) {
      console.error("[signRecord] saveAnswerScoreEvent failed", err);
      wx.showToast({
        title: "评分失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  formatSimpleDateTime(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value || "");
    }

    const pad = (num) => String(num).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + " " + [
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join(":");
  },

  async onTapRandomRollcall() {
    return this.startRandomRollcall();
  },

  async startRandomRollcall(options = {}) {
    const excludeStudentKeys = new Set(
      (Array.isArray(options.excludeStudentKeys) ? options.excludeStudentKeys : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    );
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const currentManagedLessonId = this.getActiveLessonId();
    if (!lessonId) {
      wx.showToast({
        title: "当前无可用课次",
        icon: "none"
      });
      return;
    }

    if (!currentManagedLessonId) {
      wx.showToast({
        title: "当前无进行中的课次",
        icon: "none"
      });
      return;
    }

    if (!this.isWritableCurrentLesson(lessonId, currentManagedLessonId)) {
      wx.showToast({
        title: "历史课次仅支持查看",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.signedStudents) || this.data.signedStudents.length === 0) {
      wx.showToast({
        title: "当前无已签到学生可点名",
        icon: "none"
      });
      return;
    }

    if (this.data.isRolling || this.data.pendingScoreLock || this.data.currentCalledStudent) {
      wx.showToast({
        title: "请先完成当前点名评分",
        icon: "none"
      });
      return;
    }

    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    const calledIdSet = new Set(
      (this.data.currentRoundCalledIds || []).map((item) => String(item || "").trim()).filter(Boolean)
    );
    let round = Number(this.data.currentRound || 1);
    let candidateList = signedStudents.filter((item) => {
      const studentKey = this.getStudentUniqueId(item);
      return !calledIdSet.has(studentKey) && !excludeStudentKeys.has(studentKey);
    });

    if (candidateList.length === 0) {
      const roundComplete = this.isRoundComplete(round, this.latestClassRollcallEvents);
      if (roundComplete) {
        round += 1;
        candidateList = signedStudents.filter((item) => !excludeStudentKeys.has(this.getStudentUniqueId(item)));
        this.setData({
          currentRound: round,
          currentRoundCalledIds: [],
          currentRoundProgressCount: 0
        });
      } else {
        candidateList = signedStudents.filter((item) => !excludeStudentKeys.has(this.getStudentUniqueId(item)));
      }
    }

    const continuationContext = await this.buildContinuationContext(round, candidateList);
    const weightedGroups = this.getWeightedCandidateGroups(candidateList, continuationContext);
    const student = this.pickStudentFromWeightedGroups(weightedGroups);

    if (!student) {
      wx.showToast({
        title: "当前无可点名学生",
        icon: "none"
      });
      return;
    }

    const rollcallEventId = await this.createLessonEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "rollcall",
      score: 0,
      round,
      payload: { source: "signed_random" }
    });

    if (!rollcallEventId) return;

    const studentKey = this.getStudentUniqueId(student);
    const nextCalledIds = Array.from(new Set([...(this.data.currentRoundCalledIds || []), studentKey]));
    const calledStudent = this.decorateCalledStudent({
      ...student,
      _id: String(rollcallEventId === true ? "" : rollcallEventId || "").trim()
    }, round);
    const diceValues = this.getDiceValuesForStudent(calledStudent, round);
    const nextRoundCalledSet = this.getRoundCalledStudentKeySet(round, this.latestClassRollcallEvents);
    nextRoundCalledSet.add(studentKey);
    const rosterStudentKeySet = this.getRosterStudentKeySet();
    const nextProgressCount = rosterStudentKeySet.size > 0
      ? Array.from(rosterStudentKeySet).filter((key) => nextRoundCalledSet.has(key)).length
      : nextRoundCalledSet.size;
    const rollingStartedAt = Date.now();
    const verifyStartedAt = rollingStartedAt + this.rollingDurationSeconds * 1000;
    const verifyEndsAt = this.getVerifyEndsAt(verifyStartedAt);
    this.setRollingDisplayState();
    this.setData({
      currentCalledStudent: calledStudent,
      currentRound: round,
      currentRoundCalledIds: nextCalledIds,
      currentRoundProgressCount: nextProgressCount,
      currentRoundTotalCount: this.getRosterStudentKeySet().size || signedStudents.length,
      pendingScoreLock: true,
      selectedScore: 0,
      lastScoredStudentName: "",
      lastScoredRound: 0,
      recordSubmitting: false
    });
    await this.playDiceRollAnimation(diceValues.leftValue, diceValues.rightValue, calledStudent.studentId);
    this.setData({
      verifyStartedAt,
      verifyEndsAt
    });
    this.startDisplayFlow(calledStudent, {
      verifyStartedAt,
      verifyEndsAt
    });
    this.rebuildLessonStats({
      lessonEvents: this.data.lessonEvents,
      signedStudents,
      includePendingCurrent: true
    });
    await this.loadLessonEvents();
    wx.showToast({
      title: `已点名${student.name}`,
      icon: "none"
    });
  },

  onTapScoreAnswer(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const student = this.data.currentCalledStudent;

    if (!student || !student.name) {
      wx.showToast({
        title: "请先随机点名",
        icon: "none"
      });
      return;
    }

    if (!score) {
      wx.showToast({
        title: "分值无效",
        icon: "none"
      });
      return;
    }

    this.setData({
      selectedScore: score,
      recordSubmitting: false
    });
  },

  async onTapRecordResult() {
    const student = this.data.currentCalledStudent;
    const score = Number(this.data.selectedScore || 0);

    if (!student || !student.name) {
      wx.showToast({
        title: "请先随机点名",
        icon: "none"
      });
      return;
    }

    if (!score) {
      wx.showToast({
        title: "请先选择分数",
        icon: "none"
      });
      return;
    }

    if (this.data.recordSubmitting) {
      return;
    }

    this.setData({
      recordSubmitting: true
    });

    const success = await this.saveAnswerScoreEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "answer_score",
      score,
      round: Number(student.round || this.data.currentRound || 0),
      payload: { basedOn: "rollcall" }
    });

    if (!success) {
      this.setData({
        recordSubmitting: false
      });
      return;
    }

    this.rememberRecentAnswerScore({
      studentId: student.studentId,
      studentName: student.name,
      round: Number(student.round || this.data.currentRound || 0)
    });
    this.clearDisplayTimers();
    this.setData({
      currentCalledStudent: null,
      pendingScoreLock: false,
      selectedScore: 0,
      recordSubmitting: false,
      lastScoredStudentName: String(student.name || "").trim(),
      lastScoredRound: Number(student.round || this.data.currentRound || 0)
    });
    this.setIdleDisplayState();
    await this.loadLessonEvents();
    wx.showToast({
      title: "回答得分已记录",
      icon: "none"
    });
  },

  async removeCurrentPendingRollcall() {
    const student = this.data.currentCalledStudent;
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const round = Number(student?.round || this.data.currentRound || 0);
    const currentEventId = String(student?._id || "").trim();

    if (!student || !lessonId || !classId || !round) {
      return false;
    }

    try {
      if (currentEventId) {
        try {
          await db.collection("lessonEvent").doc(currentEventId).remove();
        } catch (err) {
          const errText = String(err?.errMsg || err?.message || "");
          if (!errText.includes("cannot remove document")) {
            throw err;
          }
        }
        return true;
      }

      const res = await db.collection("lessonEvent")
        .where({
          classId,
          lessonId,
          type: "rollcall",
          round
        })
        .get();

      const target = (res.data || []).find(
        (item) => this.getStudentUniqueId(item) === this.getStudentUniqueId(student)
      );

      if (!target?._id) {
        return true;
      }

      try {
        await db.collection("lessonEvent").doc(target._id).remove();
      } catch (err) {
        const errText = String(err?.errMsg || err?.message || "");
        if (!errText.includes("cannot remove document")) {
          throw err;
        }
      }
      return true;
    } catch (err) {
      console.error("[randomRollcall] removeCurrentPendingRollcall failed", err);
      wx.showToast({
        title: "换一个失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async onTapReplaceStudent() {
    const student = this.data.currentCalledStudent;
    if (!student || !student.name) {
      wx.showToast({
        title: "请先随机点名",
        icon: "none"
      });
      return;
    }

    const removed = await this.removeCurrentPendingRollcall();
    if (!removed) {
      return;
    }

    const excludedStudentKey = this.getStudentUniqueId(student);
    this.clearDisplayTimers();
    this.setRollingDisplayState();
    this.setData({
      currentCalledStudent: null,
      pendingScoreLock: false,
      selectedScore: 0,
      recordSubmitting: false
    });
    await this.startRandomRollcall({
      excludeStudentKeys: excludedStudentKey ? [excludedStudentKey] : []
    });
  },

  /**
   * 加载班级花名册
   * 从 classes 集合获取 roster 数组，构建初始列表
   */
  async loadRoster() {
    const cid = this.data.classId;
    if (!cid) return;

    try {
      let students = [];
      let cloudCount = 0;

      try {
        const res = await db.collection("classes").doc(cid).get();
        const cloudStudents = res.data.roster || [];
        cloudCount = cloudStudents.length;
        students = cloudStudents;
      } catch (cloudErr) {
        console.error("[signRecord] load cloud roster failed", cloudErr);
      }

      if (!Array.isArray(students) || students.length === 0) {
        const localStudents = wx.getStorageSync(`students_${cid}`) || [];
        students = localStudents;
      }

      const list = students
        .map((student) => this.normalizeRosterItem(student))
        .filter((item) => item.name);
      const baseRosterList = list.map((item) => ({ ...item }));
      this.setData({
        baseRosterList,
        list: baseRosterList.map((item) => ({ ...item }))
      });
      this.refreshSignedStudents();
    } catch (err) {
      console.error("加载花名册失败：", err);
      this.setData({
        pageErrorText: "名单读取失败，请下拉刷新或重新加载。"
      });
      wx.showToast({ title: "加载名单失败", icon: "none" });
    }
  },

  async loadLessons() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) {
      this.setData({ lessons: [] });
      return [];
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonsByClass",
        data: { classId }
      });
      const lessons = this.normalizeLessons(
        res.result?.success ? (res.result.lessons || []) : []
      );
      const currentLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
      this.setData({
        lessons,
        currentLessonLabel: this.getLessonOrderLabel(currentLessonId, lessons),
        currentManagedLessonId: this.getActiveLessonId(lessons)
      });
      return lessons;
    } catch (err) {
      console.error("[signRecord] load lessons failed", {
        classId,
        err
      });
      this.setData({
        pageErrorText: "课次读取失败，请下拉刷新或重新加载。"
      });
      this.setData({ lessons: [] });
      return [];
    }
  },

  getStoredLatestLessonId() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) return "";
    return String(wx.getStorageSync(`LATEST_LESSON_${classId}`) || "").trim();
  },

  findExistingLessonId(lessons = [], lessonId = "") {
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return "";
    const matchedLesson = (lessons || []).find((item) => String(item?._id || "").trim() === targetLessonId);
    return matchedLesson ? targetLessonId : "";
  },

  async syncLessonsAfterReturn() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) return false;

    const lessons = await this.loadLessons();
    if (!Array.isArray(lessons) || lessons.length === 0) {
      const currentLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
      if (currentLessonId) {
        await this.switchLesson("");
        return true;
      }
      return false;
    }

    const currentLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const activeLessonId = this.getActiveLessonId(lessons);

    let nextLessonId = "";
    if (activeLessonId && activeLessonId !== currentLessonId) {
      nextLessonId = activeLessonId;
    } else if (!currentLessonId) {
      nextLessonId = this.resolveInitialLessonId(lessons);
    }

    if (!nextLessonId || nextLessonId === currentLessonId) {
      return false;
    }

    await this.switchLesson(nextLessonId);
    return true;
  },

  resolveInitialLessonId(lessons = []) {
    const activeLessonId = this.getActiveLessonId(lessons);
    if (activeLessonId) {
      return activeLessonId;
    }

    const incomingLessonId = this.findExistingLessonId(
      lessons,
      String(this.data.selectedLessonId || this.data.lessonId || "").trim()
    );
    if (incomingLessonId) {
      return incomingLessonId;
    }

    const cachedLatestLessonId = this.findExistingLessonId(lessons, this.getStoredLatestLessonId());
    if (cachedLatestLessonId) {
      return cachedLatestLessonId;
    }

    if (lessons.length > 0) {
      return String(lessons[0]?._id || "").trim();
    }

    const currentLessonId = String(this.data.lessonId || "").trim();
    const selectedLessonId = String(this.data.selectedLessonId || "").trim();
    return String(selectedLessonId || currentLessonId || "").trim();
  },

  async switchLesson(lessonId) {
    const nextLessonId = String(lessonId || "").trim();
    const currentManagedLessonId = this.getActiveLessonId();
    if (!nextLessonId) {
      this.clearAttendancePolling();
      this.clearLessonEventPolling();
      this.clearRollAnimationTimers();
      const list = this.cloneBaseRosterList();
      this.setData({
        lessonId: "",
        selectedLessonId: "",
        currentLessonLabel: "",
        currentManagedLessonId,
        list
      });
      this.resetDiceDisplay();
      await this.refreshInteractionDataAfterLessonChange();
      return;
    }

    this.clearAttendancePolling();
    this.clearLessonEventPolling();
    this.clearRollAnimationTimers();

    const baseList = this.cloneBaseRosterList();
    this.setData({
      lessonId: nextLessonId,
      selectedLessonId: nextLessonId,
      currentLessonLabel: this.getLessonOrderLabel(nextLessonId),
      currentManagedLessonId,
      list: baseList
    });
    this.resetDiceDisplay();
    await Promise.all([
      this.fetchAttendanceOnce(nextLessonId),
      this.refreshInteractionDataAfterLessonChange({ shouldLoadLessonEvents: false }),
      this.loadLessonEvents({ silent: true, deferClassProgress: true })
    ]);
    if (this.isWritableCurrentLesson(nextLessonId, currentManagedLessonId)) {
      this.startAttendancePolling(nextLessonId);
      this.startLessonEventPolling(nextLessonId);
    }
  },

  onSelectLesson(e) {
    const lessonId = String(e.currentTarget.dataset.lessonId || "").trim();
    if (!lessonId || lessonId === this.data.selectedLessonId) return;
    this.switchLesson(lessonId);
  },

  async fetchAttendanceOnce(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId) {
      return;
    }

    if (!classId) {
      return;
    }

    try {
      const res = await db.collection("attendance")
        .where({ lessonId })
        .get();
      const docs = res.data || [];
      this.syncAttendance(docs);
    } catch (err) {
      console.error("[signRecord] fetch attendance failed", {
        classId,
        lessonId,
        err
      });
    }
  },

  startAttendancePolling(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId) {
      return;
    }

    if (!classId) {
      return;
    }

    this.clearAttendancePolling();

    this.attendancePollingLessonId = lessonId;
    this.attendancePollingTimer = setInterval(() => {
      this.fetchAttendanceOnce(lessonId);
    }, 3000);
  },

  startLessonEventPolling(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();

    if (!lessonId) {
      return;
    }

    this.clearLessonEventPolling();

    this.lessonEventPollingLessonId = lessonId;
    this.lessonEventPollingTimer = setInterval(() => {
      this.loadLessonEvents({ silent: true });
    }, 5000);
  },

  clearAttendancePolling() {
    if (this.attendancePollingTimer) {
      clearInterval(this.attendancePollingTimer);
    }
    this.attendancePollingTimer = null;
    this.attendancePollingLessonId = "";
  },

  clearLessonEventPolling() {
    if (this.lessonEventPollingTimer) {
      clearInterval(this.lessonEventPollingTimer);
    }
    this.lessonEventPollingTimer = null;
    this.lessonEventPollingLessonId = "";
  },

  async refreshAttendance() {
    await this.fetchAttendanceOnce(this.data.selectedLessonId || this.data.lessonId);
  },

  // 将签到数据同步到当前列表
  syncAttendance(docs) {
    this.latestAttendanceDocs = Array.isArray(docs) ? docs : [];
    this.rebuildStudentDisplayList({ attendanceDocs: this.latestAttendanceDocs });
    this.rebuildRollcallState(this.latestClassRollcallEvents);
  }
});
