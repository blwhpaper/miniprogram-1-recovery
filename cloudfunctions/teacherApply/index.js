const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const USERS_COLLECTION = 'users'
const TEACHERS_COLLECTION = 'teachers'

let localSettings = {}
try {
  // Local-only admin review password config. Keep this out of committed production paths.
  localSettings = require('./local.settings.json')
} catch (err) {
  localSettings = {}
}

const DEV_ADMIN_REVIEW_PASSWORD = String(localSettings.DEV_ADMIN_REVIEW_PASSWORD || '').trim()
const ADMIN_REVIEW_KEYS = DEV_ADMIN_REVIEW_PASSWORD ? [DEV_ADMIN_REVIEW_PASSWORD] : []
const ADMIN_OPENIDS = []

function normalizeApplication(application = {}, openId = '') {
  if (!application || typeof application !== 'object') {
    return null
  }

  const applicantName = String(application.applicantName || '').trim()
  const contactInfo = String(application.contactInfo || '').trim()
  const remark = String(application.remark || '').trim()
  const status = String(application.status || '').trim()

  if (!applicantName && !contactInfo && !status) {
    return null
  }

  return {
    applicantOpenId: String(application.applicantOpenId || openId || '').trim(),
    applicantName,
    contactInfo,
    remark,
    status,
    createdAt: application.createdAt || null,
    updatedAt: application.updatedAt || null,
    reviewedAt: application.reviewedAt || null,
    reviewedByOpenId: String(application.reviewedByOpenId || '').trim()
  }
}

function normalizeTeacherProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return null
  }

  const teacherId = String(profile.teacherId || '').trim()
  const status = String(profile.status || '').trim()
  if (!teacherId && !status) {
    return null
  }

  return {
    teacherId,
    status,
    approvedAt: profile.approvedAt || null,
    updatedAt: profile.updatedAt || null
  }
}

function normalizeTeacherRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return null
  }

  const userOpenid = String(record.userOpenid || '').trim()
  const teacherId = String(record.teacherId || '').trim()
  const status = String(record.status || '').trim()

  if (!userOpenid && !teacherId && !status) {
    return null
  }

  return {
    userOpenid,
    teacherId,
    status,
    isTestTeacher: !!record.isTestTeacher,
    applicationId: String(record.applicationId || '').trim(),
    name: String(record.name || '').trim(),
    phone: String(record.phone || '').trim(),
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    approvedAt: record.approvedAt || null,
    approvedBy: String(record.approvedBy || '').trim()
  }
}

function teacherRecordToProfile(record = {}) {
  const normalizedRecord = normalizeTeacherRecord(record)
  if (!normalizedRecord) {
    return null
  }

  return normalizeTeacherProfile({
    teacherId: normalizedRecord.teacherId,
    status: normalizedRecord.status,
    approvedAt: normalizedRecord.approvedAt,
    updatedAt: normalizedRecord.updatedAt
  })
}

function normalizeRoles(roles = {}) {
  if (!roles || typeof roles !== 'object') {
    return {
      teacher: false
    }
  }

  return {
    ...roles,
    teacher: !!roles.teacher
  }
}

function hasTeacherRole(roles = {}) {
  return !!normalizeRoles(roles).teacher
}

function hasActiveTeacherRecord(record = {}) {
  const normalizedRecord = normalizeTeacherRecord(record)
  if (!normalizedRecord) return false
  return normalizedRecord.status === 'active' && !!normalizedRecord.teacherId
}

function hasAdminAccess({ openId = '', adminReviewKey = '' } = {}) {
  const normalizedOpenId = String(openId || '').trim()
  const normalizedReviewKey = String(adminReviewKey || '').trim()

  if (normalizedOpenId && ADMIN_OPENIDS.includes(normalizedOpenId)) {
    return true
  }

  if (normalizedReviewKey && ADMIN_REVIEW_KEYS.includes(normalizedReviewKey)) {
    return true
  }

  return false
}

function buildTeacherId(user = {}, existingTeacherProfile = {}, existingTeacherRecord = {}) {
  const existingTeacherRecordId = String(existingTeacherRecord?.teacherId || '').trim()
  if (existingTeacherRecordId) return existingTeacherRecordId

  const existingTeacherId = String(existingTeacherProfile?.teacherId || '').trim()
  if (existingTeacherId) return existingTeacherId

  const userIdSeed = String(user?._id || user?._openid || '').replace(/[^0-9a-zA-Z]/g, '').slice(-8).toUpperCase()
  return `TEACHER_${userIdSeed || Date.now()}`
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || 'get').trim()

  try {
    const userRes = await db.collection(USERS_COLLECTION).where({
      _openid: OPENID
    }).limit(1).get()
    const teacherRes = await db.collection(TEACHERS_COLLECTION).where({
      userOpenid: OPENID
    }).limit(1).get()

    const existingUser = (userRes.data || [])[0] || null
    const existingTeacherRecord = normalizeTeacherRecord((teacherRes.data || [])[0] || null)
    const existingApplication = normalizeApplication(existingUser?.teacherApplication, OPENID)
    const existingTeacherProfile = normalizeTeacherProfile(existingUser?.teacherProfile)
    const teacherProfileFromRecord = teacherRecordToProfile(existingTeacherRecord)
    const effectiveTeacherProfile = teacherProfileFromRecord || existingTeacherProfile
    const existingRoles = normalizeRoles(existingUser?.roles)
    const isTeacherFromTeachers = hasActiveTeacherRecord(existingTeacherRecord)
    const effectiveIsTeacher = isTeacherFromTeachers

    if (action === 'get') {
      return {
        success: true,
        hasApplication: !!existingApplication,
        application: existingApplication,
        teacherProfile: effectiveTeacherProfile,
        teacherRecord: existingTeacherRecord,
        roles: existingRoles,
        isTeacher: effectiveIsTeacher
      }
    }

    if (action === 'list') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const listRes = await db.collection(USERS_COLLECTION).limit(100).get()
      const teacherListRes = await db.collection(TEACHERS_COLLECTION).limit(100).get()
      const teacherByOpenid = new Map(
        (teacherListRes.data || [])
          .map((item) => normalizeTeacherRecord(item))
          .filter(Boolean)
          .map((item) => [item.userOpenid, item])
      )
      const applications = (listRes.data || [])
        .map((user) => {
          const application = normalizeApplication(user?.teacherApplication, user?._openid || '')
          if (!application) return null
          const teacherRecord = teacherByOpenid.get(String(user?._openid || '').trim()) || null
          return {
            _openid: String(user?._openid || '').trim(),
            application,
            teacherProfile: teacherRecordToProfile(teacherRecord) || normalizeTeacherProfile(user?.teacherProfile)
          }
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = new Date(a.application.updatedAt || a.application.createdAt || 0).getTime() || 0
          const bTime = new Date(b.application.updatedAt || b.application.createdAt || 0).getTime() || 0
          return bTime - aTime
        })

      return {
        success: true,
        applications
      }
    }

    if (action === 'review') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const applicantOpenId = String(event.applicantOpenId || '').trim()
      const reviewStatus = String(event.reviewStatus || '').trim()

      if (!applicantOpenId) {
        return {
          success: false,
          msg: '缺少申请人 openid'
        }
      }

      if (!['approved', 'rejected'].includes(reviewStatus)) {
        return {
          success: false,
          msg: '无效审核动作'
        }
      }

      const targetRes = await db.collection(USERS_COLLECTION).where({
        _openid: applicantOpenId
      }).limit(1).get()
      const targetTeacherRes = await db.collection(TEACHERS_COLLECTION).where({
        userOpenid: applicantOpenId
      }).limit(1).get()
      const targetUser = (targetRes.data || [])[0] || null
      const targetTeacherRecord = normalizeTeacherRecord((targetTeacherRes.data || [])[0] || null)

      if (!targetUser) {
        return {
          success: false,
          msg: '申请记录不存在'
        }
      }

      const targetApplication = normalizeApplication(targetUser.teacherApplication, applicantOpenId)
      if (!targetApplication) {
        return {
          success: false,
          msg: '申请记录不存在'
        }
      }

      const nextApplication = {
        applicantOpenId,
        applicantName: targetApplication.applicantName,
        contactInfo: targetApplication.contactInfo,
        remark: targetApplication.remark,
        status: reviewStatus,
        createdAt: targetUser.teacherApplication?.createdAt || db.serverDate(),
        updatedAt: db.serverDate(),
        reviewedAt: db.serverDate(),
        reviewedByOpenId: OPENID
      }

      const nextTeacherProfile = reviewStatus === 'approved'
        ? {
            teacherId: buildTeacherId(targetUser, targetUser.teacherProfile, targetTeacherRecord),
            status: 'active',
            approvedAt: targetUser.teacherProfile?.approvedAt || db.serverDate(),
            updatedAt: db.serverDate()
          }
        : _.remove()
      const nextRoles = {
        ...normalizeRoles(targetUser.roles),
        teacher: reviewStatus === 'approved'
      }

      await db.collection(USERS_COLLECTION).doc(targetUser._id).update({
        data: {
          teacherApplication: nextApplication,
          teacherProfile: nextTeacherProfile,
          roles: nextRoles
        }
      })

      if (reviewStatus === 'approved') {
        const nextTeacherRecord = {
          userOpenid: applicantOpenId,
          teacherId: nextTeacherProfile.teacherId,
          status: 'active',
          isTestTeacher: true,
          applicationId: String(targetUser._id || '').trim(),
          name: targetApplication.applicantName,
          phone: targetApplication.contactInfo,
          createdAt: targetTeacherRecord?.createdAt || db.serverDate(),
          updatedAt: db.serverDate(),
          approvedAt: targetTeacherRecord?.approvedAt || db.serverDate(),
          approvedBy: OPENID
        }

        if (targetTeacherRecord && targetTeacherRes.data?.[0]?._id) {
          await db.collection(TEACHERS_COLLECTION).doc(targetTeacherRes.data[0]._id).update({
            data: nextTeacherRecord
          })
        } else {
          await db.collection(TEACHERS_COLLECTION).add({
            data: nextTeacherRecord
          })
        }
      } else if (targetTeacherRecord && targetTeacherRes.data?.[0]?._id) {
        await db.collection(TEACHERS_COLLECTION).doc(targetTeacherRes.data[0]._id).update({
          data: {
            status: 'inactive',
            updatedAt: db.serverDate(),
            approvedBy: OPENID
          }
        })
      }

      return {
        success: true,
        application: normalizeApplication(nextApplication, applicantOpenId),
        teacherProfile: reviewStatus === 'approved'
          ? normalizeTeacherProfile({
              teacherId: buildTeacherId(targetUser, targetUser.teacherProfile, targetTeacherRecord),
              status: 'active',
              approvedAt: targetTeacherRecord?.approvedAt || targetUser.teacherProfile?.approvedAt || null,
              updatedAt: null
            })
          : null,
        msg: reviewStatus === 'approved' ? '审核通过' : '已驳回'
      }
    }

    if (action === 'reset') {
      const adminReviewKey = String(event.adminReviewKey || '').trim()
      if (!hasAdminAccess({ openId: OPENID, adminReviewKey })) {
        return {
          success: false,
          msg: '无管理员权限'
        }
      }

      const applicantOpenId = String(event.applicantOpenId || '').trim()
      if (!applicantOpenId) {
        return {
          success: false,
          msg: '缺少目标账号 openid'
        }
      }

      const targetRes = await db.collection(USERS_COLLECTION).where({
        _openid: applicantOpenId
      }).limit(1).get()
      const targetTeacherRes = await db.collection(TEACHERS_COLLECTION).where({
        userOpenid: applicantOpenId
      }).limit(1).get()
      const targetUser = (targetRes.data || [])[0] || null
      const targetTeacherRecord = normalizeTeacherRecord((targetTeacherRes.data || [])[0] || null)

      if (!targetUser) {
        return {
          success: false,
          msg: '目标账号不存在'
        }
      }

      const targetApplication = normalizeApplication(targetUser.teacherApplication, applicantOpenId)
      const targetTeacherProfile = normalizeTeacherProfile(targetUser.teacherProfile)

      if (!targetApplication && !targetTeacherProfile && !targetTeacherRecord) {
        return {
          success: false,
          msg: '当前账号没有老师测试态数据'
        }
      }

      await db.collection(USERS_COLLECTION).doc(targetUser._id).update({
        data: {
          teacherApplication: _.remove(),
          teacherProfile: _.remove(),
          roles: {
            ...normalizeRoles(targetUser.roles),
            teacher: false
          }
        }
      })

      if (targetTeacherRecord && targetTeacherRes.data?.[0]?._id) {
        await db.collection(TEACHERS_COLLECTION).doc(targetTeacherRes.data[0]._id).update({
          data: {
            status: 'inactive',
            updatedAt: db.serverDate()
          }
        })
      }

      return {
        success: true,
        msg: '已重置老师测试态'
      }
    }

    if (action !== 'submit') {
      return {
        success: false,
        msg: 'invalid action'
      }
    }

    const applicantName = String(event.applicantName || '').trim()
    const contactInfo = String(event.contactInfo || '').trim()
    const remark = String(event.remark || '').trim()

    if (!applicantName) {
      return {
        success: false,
        msg: '请输入姓名'
      }
    }

    if (!contactInfo) {
      return {
        success: false,
        msg: '请输入联系方式'
      }
    }

    if (effectiveIsTeacher && effectiveTeacherProfile?.teacherId) {
      return {
        success: true,
        alreadyTeacher: true,
        application: existingApplication,
        teacherProfile: effectiveTeacherProfile,
        teacherRecord: existingTeacherRecord,
        roles: existingRoles,
        msg: '当前账号已具备教师身份'
      }
    }

    if (existingApplication?.status === 'pending') {
      return {
        success: true,
        alreadySubmitted: true,
        application: existingApplication,
        roles: existingRoles,
        msg: '已提交，等待审核'
      }
    }

    const teacherApplication = {
      applicantOpenId: OPENID,
      applicantName,
      contactInfo,
      remark,
      status: 'pending',
      createdAt: existingApplication?.createdAt || db.serverDate(),
      updatedAt: db.serverDate()
    }

    if (existingUser) {
      await db.collection(USERS_COLLECTION).doc(existingUser._id).update({
        data: {
          teacherApplication
        }
      })
    } else {
      await db.collection(USERS_COLLECTION).add({
        data: {
          _openid: OPENID,
          teacherApplication
        }
      })
    }

    return {
      success: true,
      alreadySubmitted: false,
      application: normalizeApplication(teacherApplication, OPENID),
      teacherProfile: effectiveTeacherProfile,
      teacherRecord: existingTeacherRecord,
      roles: existingRoles,
      msg: '提交成功'
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message
    }
  }
}
