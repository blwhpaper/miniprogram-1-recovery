const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const AUTO_END_AFTER_MS = 115 * 60 * 1000

function getTimestamp(value) {
  const rawValue = value && typeof value.toDate === 'function' ? value.toDate() : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

async function cleanupAndFindActiveLesson(classId = '') {
  const res = await db.collection('lessons')
    .where({
      classId,
      status: 'active'
    })
    .get()

  const lessons = Array.isArray(res.data) ? res.data : []
  const now = Date.now()
  const activeLessons = []

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
      continue
    }

    activeLessons.push(lesson)
  }

  activeLessons.sort((left, right) => getTimestamp(right.startTime || right.createdAt) - getTimestamp(left.startTime || left.createdAt))
  return activeLessons[0] || null
}

exports.main = async (event, context) => {
  const { classId } = event
  const wxContext = cloud.getWXContext()
  const { OPENID, ENV = "" } = wxContext
  console.log("[createLesson] classId =", classId)
  console.log("[createLesson] env context =", {
    env: ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || "",
    tcbEnv: process.env.TCB_ENV || "",
    scfNamespace: process.env.SCF_NAMESPACE || ""
  })

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required'
    }
  }

  try {
    console.log("[createLesson] input classId =", classId)
    const existedActiveLesson = await cleanupAndFindActiveLesson(classId)
    if (existedActiveLesson) {
      return {
        success: false,
        env: ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || "",
        lessonId: String(existedActiveLesson._id || '').trim(),
        verifyExists: true,
        verifyClassId: String(existedActiveLesson.classId || '').trim(),
        verifyStatus: String(existedActiveLesson.status || '').trim(),
        msg: 'current active lesson already exists'
      }
    }

    const addRes = await db.collection('lessons').add({
      data: {
        classId: classId,
        teacherOpenid: OPENID,
        startTime: db.serverDate(),
        status: 'active'
      }
    })
    const lessonId = String(addRes._id || addRes.id || '').trim()
    console.log("[createLesson] add result =", addRes)
    console.log("[createLesson] normalized lessonId =", {
      lessonId,
      raw_id: addRes._id || '',
      rawId: addRes.id || ''
    })

    if (!lessonId) {
      throw new Error('createLesson add succeeded but no lesson document id was returned')
    }

    const verifyRes = await db.collection('lessons').doc(lessonId).get()
    const createdLesson = verifyRes.data || null
    console.log("[createLesson] verify lesson doc =", {
      lessonId,
      exists: !!createdLesson,
      classId: String(createdLesson?.classId || '').trim(),
      status: String(createdLesson?.status || '').trim()
    })

    if (!createdLesson) {
      throw new Error('lesson created but could not be reloaded from lessons collection')
    }

    return {
      success: true,
      lessonId,
      env: ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || "",
      verifyExists: true,
      verifyClassId: String(createdLesson.classId || '').trim(),
      verifyStatus: String(createdLesson.status || '').trim(),
      msg: 'Lesson started successfully'
    }
  } catch (err) {
    return {
      success: false,
      env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || "",
      msg: err.message
    }
  }
}
