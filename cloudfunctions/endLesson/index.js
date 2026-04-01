const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const classId = String(event.classId || '').trim()
  const lessonId = String(event.lessonId || '').trim()

  if (!classId || !lessonId) {
    return {
      success: false,
      classId,
      lessonId,
      beforeStatus: '',
      updated: 0,
      alreadyEnded: false,
      errMsg: 'classId and lessonId are required'
    }
  }

  try {
    const lessonRes = await db.collection('lessons').doc(lessonId).get()
    const lesson = lessonRes?.data || null

    if (!lesson) {
      return {
        success: false,
        classId,
        lessonId,
        beforeStatus: '',
        updated: 0,
        alreadyEnded: false,
        errMsg: 'lesson not found'
      }
    }

    const lessonClassId = String(lesson.classId || '').trim()
    const beforeStatus = String(lesson.status || '').trim()

    if (lessonClassId !== classId) {
      return {
        success: false,
        classId,
        lessonId,
        beforeStatus,
        updated: 0,
        alreadyEnded: false,
        errMsg: 'lesson does not belong to class'
      }
    }

    if (beforeStatus === 'ended') {
      return {
        success: true,
        classId,
        lessonId,
        beforeStatus,
        updated: 0,
        alreadyEnded: true,
        errMsg: 'lesson already ended'
      }
    }

    const updateRes = await db.collection('lessons').doc(lessonId).update({
      data: {
        status: 'ended',
        endTime: db.serverDate()
      }
    })

    const stats = updateRes?.stats || null
    const updated =
      Number(updateRes?.updated || 0) ||
      Number(updateRes?.modified || 0) ||
      Number(stats?.updated || 0) ||
      Number(stats?.modified || 0) ||
      0

    return {
      success: true,
      classId,
      lessonId,
      beforeStatus,
      updated,
      alreadyEnded: false,
      errMsg: String(updateRes?.errMsg || '').trim(),
      updateResult: updateRes || null,
      stats
    }
  } catch (err) {
    return {
      success: false,
      classId,
      lessonId,
      beforeStatus: '',
      updated: 0,
      alreadyEnded: false,
      errMsg: String(err?.message || err?.errMsg || 'end lesson failed').trim()
    }
  }
}
