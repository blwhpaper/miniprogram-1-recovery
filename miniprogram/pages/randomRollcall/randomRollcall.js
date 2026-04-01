const db = wx.cloud.database()
const _ = db.command
const { ensureApprovedTeacherSession } = require("../../utils/teacherSession");

Page({
  data: {
    classId: "",
    lessonId: "",
    pageLoading: false,
    pageErrorText: "",
    lessons: [],
    selectedLessonId: "",
    baseRosterList: [],
    list: [], // 最终展示的混合列表
    signedStudents: [],
    currentCalledStudent: null,
    lessonEvents: [],
    lessonEventsLoading: false,
    interactionScoreOptions: [60, 80, 95],
    currentRound: 1,
    currentRoundCalledIds: [],
    pendingScoreLock: false,
    lastScoredStudentName: "",
    lastScoredRound: 0,
    isRolling: false,
    diceLeftValue: 2,
    diceRightValue: 5,
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
      leftDicePips: this.getDicePips(nextLeftValue),
      rightDicePips: this.getDicePips(nextRightValue)
    });
  },

  resetDiceDisplay() {
    this.setDiceDisplay(2, 5);
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
    return {
      ...student,
      name,
      studentId,
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

  playDiceRollAnimation(finalLeftValue = 1, finalRightValue = 1) {
    this.clearRollAnimationTimers({ keepRollingState: true });
    this.setData({ isRolling: true });

    return new Promise((resolve) => {
      let tickCount = 0;
      const maxTicks = 8;

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
        this.rollAnimationFinishTimer = setTimeout(() => {
          this.rollAnimationFinishTimer = null;
          this.setDiceDisplay(finalLeftValue, finalRightValue);
          this.setData({ isRolling: false });
          resolve();
        }, 120);
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
  },

  onHide() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
    this.clearRollAnimationTimers();
  },

  async onPullDownRefresh() {
    try {
      const didSwitchLesson = await this.syncLessonsAfterReturn();
      if (didSwitchLesson) return;
      await this.refreshAttendance();
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
          list,
          currentCalledStudent: null,
          lessonEvents: [],
          lastScoredStudentName: "",
          lastScoredRound: 0
        });
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
        name: String(item.name || item.studentName || "").trim()
      }))
      .filter((item) => item.name);

    this.setData({ signedStudents });
    return signedStudents;
  },

  getRandomSignedStudent() {
    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    if (signedStudents.length === 0) return null;
    const index = Math.floor(Math.random() * signedStudents.length);
    return signedStudents[index] || null;
  },

  getStudentUniqueId(student = {}) {
    return String(
      student.studentId ||
      student.id ||
      student.openid ||
      student._openid ||
      student.name ||
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
        .filter((item) => item.type === "rollcall" && Number(item.round || 0) === targetRound)
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );
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

  rebuildRollcallState(lessonEvents = []) {
    const rollcallSource = Array.isArray(lessonEvents) && lessonEvents.length > 0
      ? lessonEvents
      : this.latestClassRollcallEvents;
    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    const signedIdSet = new Set(
      signedStudents
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );
    const rollcallEvents = (rollcallSource || [])
      .filter((item) => item.type === "rollcall")
      .sort((a, b) => this.getEventTimestamp(a) - this.getEventTimestamp(b));
    const scoreEventKeys = (rollcallSource || [])
      .filter((item) => item.type === "answer_score")
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
    const currentRoundCalledIds = Array.from(activeCalledSet).filter((id) => !signedIdSet.size || signedIdSet.has(id));
    const pendingRollcallEvents = rollcallEvents.filter((item) => !scoredRollcallKeySet.has(this.getRollcallScoreKey(item)));
    const latestPendingRollcall = pendingRollcallEvents[pendingRollcallEvents.length - 1] || null;
    const hasPendingRollcall = !!latestPendingRollcall;
    const pendingRollcallRound = latestPendingRollcall
      ? Number(latestPendingRollcall.round || activeRound || 1)
      : 0;
    const currentCalledStudent = hasPendingRollcall
      ? this.decorateCalledStudent({
        studentId: String(latestPendingRollcall.studentId || "").trim(),
        name: String(latestPendingRollcall.studentName || "").trim()
      }, pendingRollcallRound)
      : null;
    const pendingScoreLock = hasPendingRollcall;
    const roundComplete = this.isRoundComplete(activeRound, rollcallSource);

    if (hasPendingRollcall) {
      const pendingDiceValues = this.getDiceValuesForStudent(currentCalledStudent, pendingRollcallRound || activeRound);
      this.setDiceDisplay(pendingDiceValues.leftValue, pendingDiceValues.rightValue);
      this.setData({
        currentRound: pendingRollcallRound || activeRound,
        currentRoundCalledIds,
        pendingScoreLock,
        currentCalledStudent
      });
      return;
    }

    if (roundComplete) {
      this.setData({
        currentRound: activeRound + 1,
        currentRoundCalledIds: [],
        pendingScoreLock,
        currentCalledStudent
      });
      return;
    }

    this.setData({
      currentRound: activeRound,
      currentRoundCalledIds,
      pendingScoreLock,
      currentCalledStudent
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
        type: _.in(["rollcall", "answer_score"])
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
      this.latestClassRollcallEvents = [];
      this.rebuildRollcallState([]);
      return [];
    }
  },

  async loadLessonEvents(options = {}) {
    const { silent = false } = options;
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      this.setData({
        lessonEvents: [],
        lessonEventsLoading: false
      });
      await this.loadClassRollcallProgressEvents();
      return [];
    }

    if (!silent) {
      this.setData({ lessonEventsLoading: true });
    }
    try {
      const rawEvents = await this.queryLessonEventList({ lessonId });
      const lessonEvents = (rawEvents || [])
        .map((item) => this.normalizeLessonEvent(item))
        .filter((item) => this.isRollcallRelatedLessonEvent(item));
      const nextSignature = this.getLessonEventsSignature(lessonEvents);
      const currentSignature = this.getLessonEventsSignature(this.data.lessonEvents);
      if (nextSignature === currentSignature) {
        await this.loadClassRollcallProgressEvents();
        return this.data.lessonEvents;
      }
      this.setData({ lessonEvents });
      this.rebuildStudentDisplayList({ lessonEvents });
      await this.loadClassRollcallProgressEvents();
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadLessonEvents failed", err);
      if (this.data.lessonEvents.length > 0) {
        this.setData({ lessonEvents: [] });
      }
      this.rebuildStudentDisplayList({ lessonEvents: [] });
      await this.loadClassRollcallProgressEvents();
      return [];
    } finally {
      if (!silent) {
        this.setData({ lessonEventsLoading: false });
      }
    }
  },

  async refreshInteractionDataAfterLessonChange() {
    this.refreshSignedStudents();
    this.clearRecentAnswerScoreKeys();
    this.latestAttendanceDocs = [];
    this.setData({
      currentCalledStudent: null,
      lessonEvents: [],
      pendingScoreLock: false,
      lastScoredStudentName: "",
      lastScoredRound: 0
    });
    await this.loadLessonEvents();
  },

  async createLessonEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId || !classId) {
      wx.showToast({
        title: "缺少课次信息",
        icon: "none"
      });
      return false;
    }

    try {
      await db.collection("lessonEvent").add({
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
      return true;
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
    const targetRound = Number(eventData.round || this.data.currentRound || 0);
    const targetStudentKey = this.getStudentUniqueId(eventData);

    if (!lessonId || !classId || !targetRound || !targetStudentKey) {
      wx.showToast({
        title: "评分信息不完整",
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
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      wx.showToast({
        title: "当前无可用课次",
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
    let candidateList = signedStudents.filter((item) => !calledIdSet.has(this.getStudentUniqueId(item)));

    if (candidateList.length === 0) {
      const roundComplete = this.isRoundComplete(round, this.latestClassRollcallEvents);
      if (!roundComplete) {
        wx.showToast({
          title: "本轮未完成，将在后续课次继续",
          icon: "none"
        });
        return;
      }

      round += 1;
      candidateList = signedStudents.slice();
      this.setData({
        currentRound: round,
        currentRoundCalledIds: []
      });
    }

    const weightedCandidates = this.getWeightedCandidates(candidateList);
    const studentPool = Array.isArray(weightedCandidates) ? weightedCandidates : [];
    if (studentPool.length === 0) {
      wx.showToast({
        title: "当前无可点名学生",
        icon: "none"
      });
      return;
    }

    const index = Math.floor(Math.random() * studentPool.length);
    const student = studentPool[index] || null;
    if (!student) {
      wx.showToast({
        title: "当前无已签到学生可点名",
        icon: "none"
      });
      return;
    }

    const success = await this.createLessonEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "rollcall",
      score: 0,
      round,
      payload: { source: "signed_random" }
    });

    if (!success) return;

    const studentKey = this.getStudentUniqueId(student);
    const nextCalledIds = Array.from(new Set([...(this.data.currentRoundCalledIds || []), studentKey]));
    const calledStudent = this.decorateCalledStudent(student, round);
    const diceValues = this.getDiceValuesForStudent(calledStudent, round);
    await this.playDiceRollAnimation(diceValues.leftValue, diceValues.rightValue);
    this.setData({
      currentCalledStudent: calledStudent,
      currentRound: round,
      currentRoundCalledIds: nextCalledIds,
      pendingScoreLock: true,
      lastScoredStudentName: "",
      lastScoredRound: 0
    });
    await this.loadLessonEvents();
    wx.showToast({
      title: `已点名${student.name}`,
      icon: "none"
    });
  },

  async onTapScoreAnswer(e) {
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

    const success = await this.saveAnswerScoreEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "answer_score",
      score,
      round: Number(student.round || this.data.currentRound || 0),
      payload: { basedOn: "rollcall" }
    });

    if (!success) return;

    this.rememberRecentAnswerScore({
      studentId: student.studentId,
      studentName: student.name,
      round: Number(student.round || this.data.currentRound || 0)
    });
    this.setData({
      currentCalledStudent: null,
      pendingScoreLock: false,
      lastScoredStudentName: String(student.name || "").trim(),
      lastScoredRound: Number(student.round || this.data.currentRound || 0)
    });
    await this.loadLessonEvents();
    wx.showToast({
      title: "回答得分已记录",
      icon: "none"
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
      const lessons = res.result?.success ? (res.result.lessons || []) : [];
      this.setData({ lessons });
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
    const cachedLatestLessonId = String(wx.getStorageSync(`LATEST_LESSON_${classId}`) || "").trim();
    const lessonIds = new Set(lessons.map((item) => String(item?._id || "").trim()).filter(Boolean));

    let nextLessonId = "";
    if (cachedLatestLessonId && cachedLatestLessonId !== currentLessonId && lessonIds.has(cachedLatestLessonId)) {
      nextLessonId = cachedLatestLessonId;
    } else if (!currentLessonId || !lessonIds.has(currentLessonId)) {
      nextLessonId = this.resolveInitialLessonId(lessons);
    }

    if (!nextLessonId || nextLessonId === currentLessonId) {
      return false;
    }

    await this.switchLesson(nextLessonId);
    return true;
  },

  resolveInitialLessonId(lessons = []) {
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

    const activeLessonId = String(
      (lessons || []).find((item) => String(item?.status || "").trim() === "active")?._id || ""
    ).trim();
    if (activeLessonId) {
      return activeLessonId;
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
    if (!nextLessonId) {
      this.clearAttendancePolling();
      this.clearLessonEventPolling();
      this.clearRollAnimationTimers();
      const list = this.cloneBaseRosterList();
      this.setData({
        lessonId: "",
        selectedLessonId: "",
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
      list: baseList
    });
    this.resetDiceDisplay();
    await this.refreshInteractionDataAfterLessonChange();

    await this.fetchAttendanceOnce(nextLessonId);
    this.startAttendancePolling(nextLessonId);
    this.startLessonEventPolling(nextLessonId);
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
