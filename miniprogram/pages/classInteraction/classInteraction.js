const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    classId: "",
    lessonId: "",
    lessons: [],
    selectedLessonId: "",
    lessonsLoading: false,
    baseRosterList: [],
    stats: [],
    currentStats: null,
    statsLoading: false,
    list: [], // 最终展示的混合列表
    detailExportDisabled: true,
    statsExportDisabled: true,
    lessonEvents: [],
    lessonEventsLoading: false,
    interactionScoreOptions: [60, 80, 95],
    pendingQuestionRequests: [],
    currentQuestionRequest: null,
    currentPublishedTest: null,
    currentTestRecords: [],
    signCount: 0,
    unsignCount: 0,
    absentCount: 0,
    waitCount: 0,
    leaveCount: 0,
    jumpCursor: {}
  },

  attendancePollingTimer: null,
  attendancePollingLessonId: "",
  lessonEventPollingTimer: null,
  lessonEventPollingLessonId: "",
  latestAttendanceDocs: [],

  normalizeRosterItem(student) {
    if (typeof student === "string") {
      return {
        studentId: "",
        name: student,
        status: "unsigned",
        img: "",
        answerScoreText: "",
        questionScoreText: "",
        testScoreText: "",
        statusLabel: "未签到",
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
      img: "",
      answerScoreText: "",
      questionScoreText: "",
      testScoreText: "",
      statusLabel: "未签到",
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

      if (!matchedDoc) {
        return {
          ...item,
          statusLabel: this.getSignStatusLabel(item.status)
        };
      }

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

  onLoad(options) {
    // 从上一页（classHome 或 studentList）传入的参数
    const lessonId = String(options.lessonId || "").trim();
    const classId = String(options.classId || "").trim();

    this.setData({
      lessonId,
      classId,
      selectedLessonId: lessonId
    }, () => {
      // 1. 先加载花名册（基础数据）
      // 2. 成功后拉取签到记录并启动轮询
      this.initData();
    });
  },

  onShow() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) return;

    this.fetchAttendanceOnce(lessonId);
    this.startAttendancePolling(lessonId);
    this.loadLessonEvents();
    this.startLessonEventPolling(lessonId);
  },

  onUnload() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
  },

  onHide() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
  },

  goToRandomRollcall() {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();

    if (!classId || !lessonId) {
      wx.showToast({
        title: "当前无可用课次",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/randomRollcall/randomRollcall?classId=${encodeURIComponent(classId)}&lessonId=${encodeURIComponent(lessonId)}`
    });
  },

  async onPullDownRefresh() {
    try {
      await this.refreshAttendance();
      await this.loadLessonEvents({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initData() {
    wx.showLoading({ title: "加载中..." });
    try {
      await this.loadRoster();
      const lessons = await this.loadLessons();
      const initialLessonId = this.resolveInitialLessonId(lessons);

      if (initialLessonId) {
        await this.switchLesson(initialLessonId);
      } else {
        const list = this.cloneBaseRosterList();
        this.setData({
          lessonId: "",
          selectedLessonId: "",
          list,
          lessonEvents: []
        });
        this.refreshSignedStudents();
        this.refreshExportDisabledState();
        this.refreshStats();
      }
      await this.loadStats();
    } finally {
      wx.hideLoading();
    }
  },

  async loadStats() {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(this.data.lessonId || this.data.selectedLessonId || "").trim();
    if (!classId) return;

    this.setData({ statsLoading: true });
    this.refreshExportDisabledState();
    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonStatsByClass",
        data: { classId }
      });

      if (res.result && res.result.success) {
        const stats = Array.isArray(res.result.stats) ? res.result.stats : [];
        const currentStats =
          stats.find(item => String(item.lessonId || "").trim() === lessonId) || null;

        this.setData({
          stats,
          currentStats
        });
        this.refreshExportDisabledState();
      } else {
        this.setData({
          stats: [],
          currentStats: null
        });
        this.refreshExportDisabledState();
      }
    } catch (err) {
      console.error("[signRecord] loadStats failed", err);
      this.setData({
        stats: [],
        currentStats: null
      });
      this.refreshExportDisabledState();
    } finally {
      this.setData({ statsLoading: false });
      this.refreshExportDisabledState();
    }
  },

  escapeCsv(value) {
    const text = String(value ?? "");
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  },

  copyCsvToClipboard(csvText, successTitle) {
    wx.setClipboardData({
      data: `\uFEFF${csvText}`,
      success: () => {
        wx.showToast({
          title: successTitle,
          icon: "none"
        });
      },
      fail: (err) => {
        console.error("[signRecord] copy csv failed", err);
        wx.showToast({
          title: "导出失败，请稍后重试",
          icon: "none"
        });
      }
    });
  },

  refreshExportDisabledState() {
    const { lessonsLoading, statsLoading, list, stats } = this.data;
    const isListInvalid = !Array.isArray(list) || list.length === 0;
    const isStatsInvalid = !Array.isArray(stats) || stats.length === 0;

    this.setData({
      detailExportDisabled: Boolean(lessonsLoading || statsLoading || isListInvalid),
      statsExportDisabled: Boolean(lessonsLoading || statsLoading || isStatsInvalid)
    });
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

    return signedStudents;
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

  getLessonEventTypeLabel(type) {
    const map = {
      rollcall: "随机点名",
      answer_score: "回答得分",
      student_question: "主动提问",
      test_publish: "测试发布",
      test_record: "随堂测试",
      question_request: "提问申请",
      question_approved: "允许提问",
      question_score: "提问得分"
    };
    return map[type] || type;
  },

  getQuestionRequestId(item = {}) {
    return String(
      item?.payload?.requestId ||
      (item.type === "question_request" ? item._id : "") ||
      ""
    ).trim();
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
        requestId: this.getQuestionRequestId(item),
        displayTime: String(item.displayTime || "")
      }))
    );
  },

  getQuestionStateSignature(pendingQuestionRequests = [], currentQuestionRequest = null) {
    return JSON.stringify({
      pendingQuestionRequests: (pendingQuestionRequests || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        requestId: this.getQuestionRequestId(item)
      })),
      currentQuestionRequest: currentQuestionRequest
        ? {
          _id: String(currentQuestionRequest._id || ""),
          studentId: String(currentQuestionRequest.studentId || ""),
          studentName: String(currentQuestionRequest.studentName || ""),
          requestId: this.getQuestionRequestId(currentQuestionRequest)
        }
        : null
    });
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
    this.refreshExportDisabledState();
    this.refreshStats();
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

  rebuildQuestionRequestState(lessonEvents = []) {
    const requestEvents = lessonEvents.filter((item) => item.type === "question_request");
    const approvedEvents = lessonEvents
      .filter((item) => item.type === "question_approved")
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const scoreEvents = lessonEvents.filter((item) => item.type === "question_score");
    const approvedRequestIds = new Set(
      approvedEvents.map((item) => this.getQuestionRequestId(item)).filter(Boolean)
    );
    const scoredRequestIds = new Set(
      scoreEvents.map((item) => this.getQuestionRequestId(item)).filter(Boolean)
    );

    const pendingQuestionRequests = requestEvents.filter((item) => {
      const requestId = this.getQuestionRequestId(item);
      return requestId && !approvedRequestIds.has(requestId) && !scoredRequestIds.has(requestId);
    });

    const currentQuestionRequest = approvedEvents.find((item) => {
      const requestId = this.getQuestionRequestId(item);
      return requestId && !scoredRequestIds.has(requestId);
    }) || null;

    const nextSignature = this.getQuestionStateSignature(pendingQuestionRequests, currentQuestionRequest);
    const currentSignature = this.getQuestionStateSignature(
      this.data.pendingQuestionRequests,
      this.data.currentQuestionRequest
    );

    if (nextSignature !== currentSignature) {
      this.setData({
        pendingQuestionRequests,
        currentQuestionRequest
      });
    }
  },

  rebuildCurrentTestState(lessonEvents = []) {
    const publishedTests = lessonEvents
      .filter((item) => item.type === "test_publish" && item.testType === "single_choice")
      .sort((a, b) => this.getEventTimestamp(b) - this.getEventTimestamp(a));
    const currentPublishedTest = publishedTests[0] || null;
    const currentQuestionId = String(currentPublishedTest?._id || "").trim();
    const currentTestRecords = currentQuestionId
      ? lessonEvents.filter(
        (item) => item.type === "test_record" && item.testQuestionId === currentQuestionId
      )
      : [];

    this.setData({
      currentPublishedTest,
      currentTestRecords
    });
  },

  async loadQuestionRequestState() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      this.rebuildQuestionRequestState([]);
      return [];
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: _.in(["question_request", "question_approved", "question_score"])
        })
        .orderBy("createdAt", "desc")
        .get();
      const lessonEvents = (res.data || []).map((item) => this.normalizeLessonEvent(item));
      this.rebuildQuestionRequestState(lessonEvents);
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadQuestionRequestState failed", err);
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
      return [];
    }

    if (!silent) {
      this.setData({ lessonEventsLoading: true });
    }
    try {
      const res = await db.collection("lessonEvent")
        .where({ lessonId })
        .orderBy("createdAt", "desc")
        .get();
      const lessonEvents = (res.data || []).map((item) => this.normalizeLessonEvent(item));
      const nextSignature = this.getLessonEventsSignature(lessonEvents);
      const currentSignature = this.getLessonEventsSignature(this.data.lessonEvents);
      if (nextSignature !== currentSignature) {
        this.setData({ lessonEvents });
      }
      this.rebuildStudentDisplayList({ lessonEvents });
      this.rebuildQuestionRequestState(lessonEvents);
      this.rebuildCurrentTestState(lessonEvents);
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadLessonEvents failed", err);
      if (this.data.lessonEvents.length > 0) {
        this.setData({ lessonEvents: [] });
      }
      this.rebuildStudentDisplayList({ lessonEvents: [] });
      this.rebuildQuestionRequestState([]);
      this.rebuildCurrentTestState([]);
      return [];
    } finally {
      if (!silent) {
        this.setData({ lessonEventsLoading: false });
      }
    }
  },

  async refreshInteractionDataAfterLessonChange() {
    this.refreshSignedStudents();
    this.latestAttendanceDocs = [];
    this.setData({
      lessonEvents: [],
      pendingQuestionRequests: [],
      currentQuestionRequest: null,
      currentPublishedTest: null,
      currentTestRecords: []
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

  async saveQuestionScoreEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const requestId = String(eventData?.payload?.requestId || "").trim();

    if (!lessonId || !classId || !requestId) {
      wx.showToast({
        title: "提问信息不完整",
        icon: "none"
      });
      return false;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          classId,
          lessonId,
          type: "question_score"
        })
        .get();

      const existed = (res.data || []).find(
        (item) => this.getQuestionRequestId(item) === requestId
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

      return this.createLessonEvent(eventData);
    } catch (err) {
      console.error("[signRecord] saveQuestionScoreEvent failed", err);
      wx.showToast({
        title: "提问评分失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async saveTestRecordEvent(eventData = {}) {
    const studentId = String(eventData.studentId || "").trim();
    const studentName = String(eventData.studentName || "").trim();
    const payload = eventData.payload || {};

    if (!studentId || !studentName) {
      wx.showToast({
        title: "测试记录学生信息不完整",
        icon: "none"
      });
      return false;
    }

    return this.createLessonEvent({
      studentId,
      studentName,
      type: "test_record",
      score: Number(eventData.score || 0),
      round: Number(eventData.round || 0),
      payload: {
        testType: String(payload.testType || "").trim(),
        testSubType: String(payload.testSubType || "").trim(),
        questionId: String(payload.questionId || "").trim(),
        options: Array.isArray(payload.options) ? payload.options : [],
        correctAnswer: String(payload.correctAnswer || "").trim(),
        result: String(payload.result || "").trim(),
        content: String(payload.content || "").trim(),
        answer: String(payload.answer || "").trim(),
        status: String(payload.status || "").trim()
      }
    });
  },

  async saveTestPublishEvent(eventData = {}) {
    const payload = eventData.payload || {};

    return this.createLessonEvent({
      studentId: "",
      studentName: "",
      type: "test_publish",
      score: 0,
      round: 0,
      payload: {
        testType: String(payload.testType || "").trim(),
        testSubType: String(payload.testSubType || "").trim(),
        options: Array.isArray(payload.options) ? payload.options : [],
        correctAnswer: String(payload.correctAnswer || "").trim(),
        content: String(payload.content || "").trim(),
        status: String(payload.status || "").trim()
      }
    });
  },

  getLessonOrderLabel(lessonId) {
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return "";

    const lessons = Array.isArray(this.data.lessons) ? this.data.lessons : [];
    const lessonIndex = lessons.findIndex(
      (item) => String(item?._id || item?.lessonId || "").trim() === targetLessonId
    );

    if (lessonIndex >= 0) {
      return `第${lessonIndex + 1}次课`;
    }

    return "";
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

  async onTapAddStudentQuestion(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();

    if (!studentName) {
      wx.showToast({
        title: "学生信息无效",
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

    const success = await this.createLessonEvent({
      studentId,
      studentName,
      type: "student_question",
      score,
      payload: { note: "" }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "主动提问已记录",
      icon: "none"
    });
  },

  async onTapApproveQuestionRequest(e) {
    const requestId = String(e.currentTarget.dataset.requestId || "").trim();
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();

    if (!requestId || !studentName) {
      wx.showToast({
        title: "提问申请无效",
        icon: "none"
      });
      return;
    }

    if (this.data.currentQuestionRequest && this.getQuestionRequestId(this.data.currentQuestionRequest) === requestId) {
      wx.showToast({
        title: "该提问已允许，待评分",
        icon: "none"
      });
      return;
    }

    if (this.data.currentQuestionRequest && this.getQuestionRequestId(this.data.currentQuestionRequest) !== requestId) {
      wx.showToast({
        title: "请先完成当前提问评分",
        icon: "none"
      });
      return;
    }

    const success = await this.createLessonEvent({
      studentId,
      studentName,
      type: "question_approved",
      score: 0,
      payload: { requestId, basedOn: "question_request" }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "已允许学生提问",
      icon: "none"
    });
  },

  async onTapScoreQuestion(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const request = this.data.currentQuestionRequest;
    const requestId = this.getQuestionRequestId(request);

    if (!request || !requestId) {
      wx.showToast({
        title: "当前无待评分提问",
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

    const success = await this.saveQuestionScoreEvent({
      studentId: request.studentId,
      studentName: request.studentName,
      type: "question_score",
      score,
      payload: { requestId, basedOn: "question_approved" }
    });

    if (!success) return;

    this.setData({ currentQuestionRequest: null });
    await this.loadLessonEvents();
    wx.showToast({
      title: "提问得分已记录",
      icon: "none"
    });
  },

  async onTapPublishTestExample() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      wx.showToast({
        title: "当前无可用课次",
        icon: "none"
      });
      return;
    }

    const success = await this.saveTestPublishEvent({
      payload: {
        testType: "single_choice",
        testSubType: "vocabulary",
        options: ["A. apple", "B. banana", "C. orange", "D. pear"],
        correctAnswer: "B",
        content: "示例单选题：banana 对应哪个选项？",
        status: "published"
      }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "全班测试样例已发布",
      icon: "none"
    });
  },

  onTapExportLessonStats() {
    if (this.data.lessonsLoading || this.data.statsLoading) {
      wx.showToast({
        title: "数据加载中，请稍后",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.stats) || this.data.stats.length === 0) {
      wx.showToast({
        title: "暂无可导出的课次统计",
        icon: "none"
      });
      return;
    }

    this.exportLessonStatsCsv();
  },

  onTapExportLessonDetail() {
    if (this.data.lessonsLoading || this.data.statsLoading) {
      wx.showToast({
        title: "数据加载中，请稍后",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.list) || this.data.list.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    this.exportLessonDetailCsv();
  },

  async exportLessonStatsCsv() {
    let stats = Array.isArray(this.data.stats) ? this.data.stats : [];

    if (stats.length === 0) {
      await this.loadStats();
      stats = Array.isArray(this.data.stats) ? this.data.stats : [];
    }

    if (stats.length === 0) {
      wx.showToast({
        title: "暂无可导出的课次统计",
        icon: "none"
      });
      return;
    }

    const classId = String(this.data.classId || "").trim();
    const header = "班级ID,课次,上课时间,应到人数,实到人数,未到人数";
    const rows = stats.map((item) => {
      const lessonLabel = this.getLessonOrderLabel(item?.lessonId) || String(item?.lessonId || "");
      const startTime = this.formatSimpleDateTime(item?.startTime);

      return [
        this.escapeCsv(classId),
        this.escapeCsv(lessonLabel),
        this.escapeCsv(startTime),
        String(item?.rosterCount ?? ""),
        String(item?.signedCount ?? ""),
        String(item?.unsignedCount ?? "")
      ].join(",");
    });
    const csvText = [header, ...rows].join("\n");
    const fileName = classId ? `签到统计_${classId}.csv` : "签到统计_全部课次.csv";

    this.copyCsvToClipboard(csvText, "全部课次统计CSV已复制，可直接粘贴到表格");
  },

  async exportLessonDetailCsv() {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(this.data.lessonId || this.data.selectedLessonId || "").trim();
    const roster = Array.isArray(this.data.baseRosterList) ? this.data.baseRosterList : [];

    if (!classId || !lessonId) {
      wx.showToast({
        title: "缺少班级或课次信息",
        icon: "none"
      });
      return;
    }

    if (roster.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    let detailList = Array.isArray(this.data.list) ? this.data.list : [];

    if (detailList.length === 0) {
      try {
        const res = await db.collection("attendance")
          .where({ lessonId })
          .get();
        const attendanceList = res.data || [];
        const signedSet = new Set(
          attendanceList
            .map(item => String(item.studentId || "").trim())
            .filter(Boolean)
        );

        detailList = roster.map((student) => {
          const studentId = String(student.studentId || student.id || "").trim();
          const name = String(student.name || student.studentName || "").trim();
          return {
            studentId,
            name,
            status: signedSet.has(studentId) ? "signed" : "unsigned"
          };
        });
      } catch (err) {
        console.error("[signRecord] exportLessonDetailCsv failed to build detail list", err);
        wx.showToast({
          title: "导出失败，请稍后重试",
          icon: "none"
        });
        return;
      }
    }

    if (detailList.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    const lessonLabel = this.getLessonOrderLabel(lessonId) || lessonId;
    const header = "班级ID,课次,学号,姓名,签到状态";
    const rows = detailList.map((item) => {
      const studentId = String(item?.studentId || item?.id || "").trim();
      const name = String(item?.name || item?.studentName || "").trim();
      const status = String(item?.status || "unsigned").trim() || "unsigned";

      return [
        this.escapeCsv(classId),
        this.escapeCsv(lessonLabel),
        this.escapeCsv(studentId),
        this.escapeCsv(name),
        this.escapeCsv(this.getSignStatusLabel(status))
      ].join(",");
    });

    const csvText = [header, ...rows].join("\n");
    const fileName = `签到明细_${lessonLabel || lessonId}.csv`;
    this.copyCsvToClipboard(csvText, "本次课明细CSV已复制，可直接粘贴到表格");
  },

  /**
   * 加载班级花名册
   * 从 classes 集合获取 roster 数组，构建初始列表
   */
  async loadRoster() {
    const cid = this.data.classId;
    const lessonId = this.data.lessonId;
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
      this.refreshExportDisabledState();
      this.refreshStats();
    } catch (err) {
      console.error("加载花名册失败：", err);
      wx.showToast({ title: "加载名单失败", icon: "none" });
    }
  },

  async loadLessons() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) {
      this.setData({
        lessons: [],
        lessonsLoading: false
      });
      this.refreshExportDisabledState();
      return [];
    }

    this.setData({ lessonsLoading: true });
    this.refreshExportDisabledState();

    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonsByClass",
        data: { classId }
      });
      const lessons = res.result?.success ? (res.result.lessons || []) : [];
      this.setData({ lessons });
      this.refreshExportDisabledState();
      return lessons;
    } catch (err) {
      console.error("[signRecord] load lessons failed", {
        classId,
        err
      });
      this.setData({ lessons: [] });
      this.refreshExportDisabledState();
      return [];
    } finally {
      this.setData({ lessonsLoading: false });
      this.refreshExportDisabledState();
    }
  },

  resolveInitialLessonId(lessons = []) {
    const currentLessonId = String(this.data.lessonId || "").trim();
    const selectedLessonId = String(this.data.selectedLessonId || "").trim();
    const candidateLessonId = selectedLessonId || currentLessonId;

    if (candidateLessonId) {
      const matched = lessons.some((lesson) => String(lesson._id || "").trim() === candidateLessonId);
      if (matched || lessons.length === 0) {
        return candidateLessonId;
      }
    }

    return String(lessons[0]?._id || "").trim();
  },

  async switchLesson(lessonId) {
    const nextLessonId = String(lessonId || "").trim();
    if (!nextLessonId) {
      this.clearAttendancePolling();
      this.clearLessonEventPolling();
      const list = this.cloneBaseRosterList();
      this.setData({
        lessonId: "",
        selectedLessonId: "",
        currentStats: null,
        list
      });
      await this.refreshInteractionDataAfterLessonChange();
      this.refreshExportDisabledState();
      this.refreshStats();
      return;
    }

    this.clearAttendancePolling();
    this.clearLessonEventPolling();

    const baseList = this.cloneBaseRosterList();
    this.setData({
      lessonId: nextLessonId,
      selectedLessonId: nextLessonId,
      currentStats: (this.data.stats || []).find(item => item.lessonId === nextLessonId) || null,
      list: baseList
    });
    await this.refreshInteractionDataAfterLessonChange();
    this.refreshExportDisabledState();
    this.refreshStats();

    await this.fetchAttendanceOnce(nextLessonId);
    this.startAttendancePolling(nextLessonId);
    this.startLessonEventPolling(nextLessonId);
    await this.loadStats();
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
  },

  /**
   * 重新计算统计数字
   */
  refreshStats() {
    const list = this.data.list;
    this.setData({
      signCount: list.filter(i => i.status === "signed").length,
      unsignCount: list.filter(i => i.status === "unsigned").length,
      absentCount: list.filter(i => i.status === "absent").length,
      waitCount: list.filter(i => i.status === "leave_wait").length,
      leaveCount: list.filter(i => i.status === "leave_agree").length,
    });
  },

  showStatus(s) {
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "已请假"
    };
    return map[s] || s;
  },

  /**
   * 锚点跳转：点击上方统计卡片快速定位学生
   */
  jumpTo(e) {
    const type = e.currentTarget.dataset.type;
    const list = this.data.list;
    const targets = list.map((item, idx) => item.status === type ? idx : -1).filter(i => i >= 0);
    
    if (targets.length === 0) return;
    
    let cur = this.data.jumpCursor[type] || 0;
    if (cur >= targets.length) cur = 0;
    
    wx.pageScrollTo({ selector: "#item-" + targets[cur], duration: 300 });
    this.setData({ [`jumpCursor.${type}`]: cur + 1 });
  },

  previewImg(e) {
    const url = e.currentTarget.dataset.src;
    if (url) wx.previewImage({ urls: [url] });
  }
});
