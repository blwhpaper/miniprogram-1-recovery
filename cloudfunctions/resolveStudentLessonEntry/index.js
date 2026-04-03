const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getSafeEnv(wxContext = {}) {
  return String(wxContext.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || '').trim()
}

function getAttendanceStatusLabel(status = '') {
  const normalizedStatus = String(status || '').trim()
  const map = {
    signed: '已签到',
    unsigned: '未签到',
    absent: '旷课',
    leave_wait: '待审批',
    leave_agree: '已请假'
  }
  return map[normalizedStatus || 'unsigned'] || '未签到'
}

function getLessonTimestamp(item = {}) {
  const rawValue = item.startTime || item.createdAt
  if (!rawValue) return 0
  if (typeof rawValue?.toDate === 'function') {
    const date = rawValue.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
  }
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

async function getBoundStudentUser(openid = '') {
  if (!openid) return null
  const res = await db.collection('users').where({
    _openid: openid
  }).limit(1).get()
  const user = (res.data || [])[0] || null
  if (!user || !user.bound || user.role !== 'student') {
    return null
  }
  return user
}

async function getAttendanceStatus(lessonId = '', studentId = '') {
  if (!lessonId || !studentId) return 'unsigned'
  const res = await db.collection('attendance').where({
    lessonId,
    studentId
  }).limit(1).get()
  const attendanceDoc = (res.data || [])[0] || null
  return String(
    attendanceDoc?.status ||
    attendanceDoc?.attendanceStatus ||
    'unsigned'
  ).trim() || 'unsigned'
}

async function getClassRoster(classId = '') {
  const normalizedClassId = String(classId || '').trim()
  if (!normalizedClassId) {
    return {
      classDoc: null,
      roster: [],
      exists: false
    }
  }

  try {
    const classRes = await db.collection('classes').doc(normalizedClassId).get()
    return {
      classDoc: classRes.data || null,
      roster: Array.isArray(classRes.data?.roster) ? classRes.data.roster : [],
      exists: !!classRes.data
    }
  } catch (err) {
    const message = String(err?.errMsg || err?.message || err || '').toLowerCase()
    const isNotFound = (
      message.includes('cannot find document') ||
      message.includes('document not exist') ||
      message.includes('document not exists')
    )

    if (isNotFound) {
      return {
        classDoc: null,
        roster: [],
        exists: false
      }
    }

    throw err
  }
}

function isStudentInRoster(user = null, roster = []) {
  if (!user || !Array.isArray(roster) || roster.length === 0) return false

  const normalizedStudentId = String(user.studentId || '').trim()
  const normalizedName = String(user.name || '').trim()
  if (!normalizedStudentId || !normalizedName) return false

  return roster.some((student = {}) => (
    String(student.studentId || student.id || '').trim() === normalizedStudentId &&
    String(student.name || '').trim() === normalizedName
  ))
}

async function resolveLessonDoc({ lessonId = '', classId = '' } = {}) {
  const normalizedLessonId = String(lessonId || '').trim()
  if (normalizedLessonId) {
    try {
      const lessonRes = await db.collection('lessons').doc(normalizedLessonId).get()
      return {
        lesson: lessonRes.data || null,
        notFound: !(lessonRes.data || null),
        resolvedBy: 'lessonId'
      }
    } catch (err) {
      const message = String(err?.errMsg || err?.message || err || '').toLowerCase()
      const isNotFound = (
        message.includes('cannot find document') ||
        message.includes('document not exist') ||
        message.includes('document not exists')
      )
      if (isNotFound) {
        return {
          lesson: null,
          notFound: true,
          resolvedBy: 'lessonId'
        }
      }
      throw err
    }
  }

  const normalizedClassId = String(classId || '').trim()
  if (!normalizedClassId) {
    return {
      lesson: null,
      notFound: false,
      resolvedBy: 'none'
    }
  }

  const res = await db.collection('lessons')
    .where({
      classId: normalizedClassId,
      status: 'active'
    })
    .get()

  const lessons = Array.isArray(res.data) ? res.data : []
  lessons.sort((left, right) => getLessonTimestamp(right) - getLessonTimestamp(left))

  return {
    lesson: lessons[0] || null,
    notFound: lessons.length === 0,
    resolvedBy: 'classId'
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const env = getSafeEnv(wxContext)
  const lessonId = String(event.lessonId || '').trim()
  const requestedClassId = String(event.classId || '').trim()
  const user = await getBoundStudentUser(String(wxContext.OPENID || '').trim())
  const studentId = String(user?.studentId || '').trim()
  const userClassId = String(user?.classId || '').trim()
  const fallbackClassId = requestedClassId || userClassId

  try {
    const { lesson, notFound, resolvedBy } = await resolveLessonDoc({
      lessonId,
      classId: fallbackClassId
    })

    if (!lesson) {
      return {
        success: true,
        env,
        lessonId: '',
        classId: fallbackClassId,
        lessonStatus: '',
        exists: false,
        readable: true,
        bound: !!studentId,
        classMatched: false,
        memberMatched: false,
        attendanceStatus: studentId ? 'unsigned' : '',
        attendanceStatusText: studentId ? getAttendanceStatusLabel('unsigned') : '',
        canEnterCurrentLesson: false,
        statusHint: 'not_found',
        resolvedBy,
        notFound,
        msg: notFound ? '当前签到课不存在，请重新扫码老师二维码' : '当前没有可进入的签到课'
      }
    }

    const resolvedLessonId = String(lesson._id || lessonId || '').trim()
    const resolvedClassId = String(lesson.classId || fallbackClassId || '').trim()
    const lessonStatus = String(lesson.status || '').trim()
    const { roster, exists: classExists } = await getClassRoster(resolvedClassId)
    const classMatched = !requestedClassId || requestedClassId === resolvedClassId
    const memberMatched = studentId ? isStudentInRoster(user, roster) : false
    const attendanceStatus = studentId && classMatched && memberMatched
      ? await getAttendanceStatus(resolvedLessonId, studentId)
      : (studentId ? 'unsigned' : '')
    const lessonActive = lessonStatus === 'active'
    const canEnterCurrentLesson = Boolean(
      lessonActive &&
      resolvedClassId &&
      classExists &&
      classMatched &&
      (!studentId || memberMatched)
    )
    let statusHint = 'enterable'
    let msg = ''

    if (!resolvedClassId) {
      statusHint = 'invalid_class'
      msg = '当前课缺少班级信息，暂不可进入'
    } else if (!classExists) {
      statusHint = 'class_not_found'
      msg = '当前班级名单不存在，暂不可进入'
    } else if (!classMatched) {
      statusHint = 'class_mismatch'
      msg = '当前签到课与学生班级不匹配，不能进入'
    } else if (studentId && !memberMatched) {
      statusHint = 'not_in_class'
      msg = '当前绑定学生不在本班级名单中'
    } else if (!lessonActive) {
      statusHint = 'inactive'
      msg = '当前课已失效，请重新扫码老师二维码'
    }

    return {
      success: true,
      env,
      lessonId: resolvedLessonId,
      classId: resolvedClassId,
      lessonStatus,
      exists: true,
      readable: true,
      bound: !!studentId,
      classMatched,
      memberMatched,
      attendanceStatus,
      attendanceStatusText: getAttendanceStatusLabel(attendanceStatus),
      canEnterCurrentLesson,
      statusHint,
      resolvedBy,
      notFound: false,
      msg
    }
  } catch (err) {
    return {
      success: false,
      env,
      lessonId,
      classId: fallbackClassId,
      lessonStatus: '',
      exists: false,
      readable: false,
      bound: !!studentId,
      classMatched: false,
      memberMatched: false,
      attendanceStatus: '',
      attendanceStatusText: '',
      canEnterCurrentLesson: false,
      statusHint: 'error',
      resolvedBy: 'error',
      notFound: false,
      msg: err.message || '系统错误'
    }
  }
}
