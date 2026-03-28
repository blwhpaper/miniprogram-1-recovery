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
  const classId = String(event.classId || '').trim()
  const user = await getBoundStudentUser(String(wxContext.OPENID || '').trim())
  const studentId = String(user?.studentId || '').trim()
  const userClassId = String(user?.classId || '').trim()
  const fallbackClassId = classId || userClassId

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
        attendanceStatus: studentId ? 'unsigned' : '',
        attendanceStatusText: studentId ? getAttendanceStatusLabel('unsigned') : '',
        canEnterCurrentLesson: false,
        statusHint: 'not_found',
        resolvedBy,
        notFound
      }
    }

    const resolvedLessonId = String(lesson._id || lessonId || '').trim()
    const resolvedClassId = String(lesson.classId || fallbackClassId || '').trim()
    const lessonStatus = String(lesson.status || '').trim()
    const attendanceStatus = studentId
      ? await getAttendanceStatus(resolvedLessonId, studentId)
      : 'unsigned'
    const canEnterCurrentLesson = (
      lessonStatus === 'active' ||
      ['signed', 'leave_wait', 'leave_agree', 'absent'].includes(attendanceStatus)
    )

    return {
      success: true,
      env,
      lessonId: resolvedLessonId,
      classId: resolvedClassId,
      lessonStatus,
      exists: true,
      readable: true,
      attendanceStatus,
      attendanceStatusText: getAttendanceStatusLabel(attendanceStatus),
      canEnterCurrentLesson,
      statusHint: canEnterCurrentLesson ? 'enterable' : 'inactive',
      resolvedBy,
      notFound: false
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
