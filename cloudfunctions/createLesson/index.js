const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
