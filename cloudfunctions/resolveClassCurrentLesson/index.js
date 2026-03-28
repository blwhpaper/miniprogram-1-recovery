const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const AUTO_END_AFTER_MS = 115 * 60 * 1000

function getTimestamp(value) {
  const rawValue = value && typeof value.toDate === 'function' ? value.toDate() : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

async function autoEndExpiredLessons(classId = '') {
  const normalizedClassId = String(classId || '').trim()
  if (!normalizedClassId) {
    return { activeLessons: [], autoEndedLessonIds: [] }
  }

  const res = await db.collection('lessons')
    .where({
      classId: normalizedClassId,
      status: 'active'
    })
    .get()

  const lessons = Array.isArray(res.data) ? res.data : []
  const now = Date.now()
  const activeLessons = []
  const autoEndedLessonIds = []

  for (let i = 0; i < lessons.length; i += 1) {
    const lesson = lessons[i] || {}
    const lessonId = String(lesson._id || '').trim()
    const startTimestamp = getTimestamp(lesson.startTime || lesson.createdAt)
    const shouldAutoEnd = startTimestamp && now >= startTimestamp + AUTO_END_AFTER_MS

    if (lessonId && shouldAutoEnd) {
      await db.collection('lessons').doc(lessonId).update({
        data: {
          status: 'ended',
          endTime: db.serverDate(),
          autoEnded: true
        }
      })
      autoEndedLessonIds.push(lessonId)
      continue
    }

    activeLessons.push(lesson)
  }

  activeLessons.sort((left, right) => {
    return getTimestamp(right.startTime || right.createdAt) - getTimestamp(left.startTime || left.createdAt)
  })

  return {
    activeLessons,
    autoEndedLessonIds
  }
}

exports.main = async (event = {}) => {
  const classId = String(event.classId || '').trim()
  const lessonId = String(event.lessonId || '').trim()

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required'
    }
  }

  try {
    const { activeLessons, autoEndedLessonIds } = await autoEndExpiredLessons(classId)
    let currentLesson = null

    if (lessonId) {
      currentLesson = activeLessons.find((item) => String(item._id || '').trim() === lessonId) || null
    }

    if (!currentLesson) {
      currentLesson = activeLessons[0] || null
    }

    return {
      success: true,
      classId,
      hasActiveLesson: !!currentLesson,
      lesson: currentLesson
        ? {
            _id: String(currentLesson._id || '').trim(),
            classId: String(currentLesson.classId || '').trim(),
            status: String(currentLesson.status || '').trim(),
            startTime: currentLesson.startTime || null,
            endTime: currentLesson.endTime || null
          }
        : null,
      autoEndedLessonIds
    }
  } catch (err) {
    console.error('[resolveClassCurrentLesson] failed', err)
    return {
      success: false,
      classId,
      hasActiveLesson: false,
      lesson: null,
      autoEndedLessonIds: [],
      msg: err.message || 'resolve current lesson failed'
    }
  }
}
