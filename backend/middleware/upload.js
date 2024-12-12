require('dotenv').config();

const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const fs = require('fs');

// S3 설정
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// MIME 타입과 확장자 매핑
const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
};

// 파일 타입별 크기 제한 설정
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024, // 10MB for images
  video: 50 * 1024 * 1024, // 50MB for videos
  audio: 20 * 1024 * 1024, // 20MB for audio
  document: 20 * 1024 * 1024, // 20MB for documents
};

const storage = multerS3({
  s3: s3,
  bucket: process.env.S3_BUCKET_NAME,
  acl: 'public-read',
  metadata: function (req, file, cb) {
    cb(null, { fieldName: file.fieldname });
  },
  key: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const safeFilename = `${timestamp}_${randomString}${ext}`;
    const fileKey = `uploads/${safeFilename}`;
    
    // S3 파일 URL 생성 및 req.file 객체에 추가
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
    file.s3 = {
      key: fileKey,
      url: fileUrl
    };

    cb(null, fileKey);
  },
  contentType: multerS3.AUTO_CONTENT_TYPE,
});

const getFileType = (mimetype) => {
  const typeMap = {
    image: '이미지',
    video: '동영상',
    audio: '오디오',
    application: '문서',
  };
  const type = mimetype.split('/')[0];
  return typeMap[type] || '파일';
};

const validateFileSize = (file) => {
  const type = file.mimetype.split('/')[0];
  const limit = FILE_SIZE_LIMITS[type] || FILE_SIZE_LIMITS.document;

  if (file.size > limit) {
    const limitInMB = Math.floor(limit / 1024 / 1024);
    throw new Error(
      `${getFileType(
        file.mimetype
      )} 파일은 ${limitInMB}MB를 초과할 수 없습니다.`
    );
  }
  return true;
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = Object.values(ALLOWED_TYPES).flat();

  if (!allowedExtensions.includes(ext)) {
    return cb(new Error('지원하지 않는 파일 형식입니다.'), false);
  }

  // MIME 타입을 체크
  const mimeType = file.mimetype;
  const allowedMIMETypes = Object.keys(ALLOWED_TYPES);

  if (!allowedMIMETypes.includes(mimeType)) {
    return cb(new Error('지원하지 않는 MIME 타입입니다.'), false);
  }

  const type = file.mimetype.split('/')[0];
  const limit = FILE_SIZE_LIMITS[type] || FILE_SIZE_LIMITS.document;

  if (file.size > limit) {
    return cb(
      new Error(
        `${type} 파일은 ${limit / 1024 / 1024}MB를 초과할 수 없습니다.`
      ),
      false
    );
  }

  cb(null, true);
};

// multer 인스턴스 생성
const uploadMiddleware = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 1, // 한 번에 하나의 파일만 업로드 가능
  },
  fileFilter: fileFilter,
});

// 에러 핸들러 미들웨어
const errorHandler = (error, req, res, next) => {
  console.error('File upload error:', {
    error: error.message,
    stack: error.stack,
    file: req.file,
  });

  // 업로드된 파일이 있다면 삭제
  if (req.file) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      console.error('Failed to delete uploaded file:', unlinkError);
    }
  }

  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          success: false,
          message: '파일 크기는 50MB를 초과할 수 없습니다.',
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: '한 번에 하나의 파일만 업로드할 수 있습니다.',
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: '잘못된 형식의 파일입니다.',
        });
      default:
        return res.status(400).json({
          success: false,
          message: `파일 업로드 오류: ${error.message}`,
        });
    }
  }

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message || '파일 업로드 중 오류가 발생했습니다.',
    });
  }

  next();
};

module.exports = {
  upload: uploadMiddleware,
  errorHandler,
  validateFileSize,
  ALLOWED_TYPES,
  getFileType,
};
