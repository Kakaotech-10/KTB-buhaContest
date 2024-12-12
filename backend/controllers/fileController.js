const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3'); // AWS SDK v3
const File = require('../models/File');
const Message = require('../models/Message');
const Room = require('../models/Room');
const { processFileForRAG } = require('../services/fileService');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const crypto = require('crypto');

// S3 클라이언트 초기화
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const generateSafeFilename = (originalname) => {
  const ext = path.extname(originalname).toLowerCase();
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  return `${timestamp}_${randomString}${ext}`;
};

// 개선된 파일 정보 조회 함수
const getFileFromRequest = async (req) => {
  try {
    const filename = req.params.filename;
    const token = req.headers['x-auth-token'] || req.query.token;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;

    if (!filename) {
      throw new Error('Invalid filename');
    }

    if (!token || !sessionId) {
      throw new Error('Authentication required');
    }

    // S3에서 파일 정보 조회
    const file = await File.findOne({ filename: filename });
    if (!file) {
      throw new Error('File not found in database');
    }

    // 채팅방 권한 검증을 위한 메시지 조회
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      throw new Error('File message not found');
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id,
    });

    if (!room) {
      throw new Error('Unauthorized access');
    }

    return { file };
  } catch (error) {
    console.error('getFileFromRequest error:', {
      filename: req.params.filename,
      error: error.message,
    });
    throw error;
  }
};

// 파일 업로드
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 선택되지 않았습니다.',
      });
    }

    const safeFilename = generateSafeFilename(req.file.originalname);
    const fileUrl = req.file.s3.url;
    const filenameWithoutUploads = req.file.key.replace(/^uploads\//, '');
    // // S3에 파일 업로드
    // const params = {
    //   Bucket: process.env.S3_BUCKET_NAME,
    //   Key: `uploads/${safeFilename}`, // S3 경로 (폴더 구조와 파일명 포함)
    //   ContentType: req.file.mimetype, // 파일 MIME 타입
    //   ACL: 'public-read', // 퍼블릭 접근 설정 (필요시 private으로 변경)
    // };

    // const command = new PutObjectCommand(params);
    // const s3Response = await s3.send(command); // S3에 파일 업로드

    // S3에서 파일 URL 가져오기
    // const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
    // console.log('Uploaded file to S3:', fileUrl);

    const file = new File({
      filename: filenameWithoutUploads,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      user: req.user.id,
      path: fileUrl, // S3 URL을 DB에 저장
    });

    await file.save();

    res.status(200).json({
      success: true,
      message: '파일 업로드 성공',
      allfiles: file,
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate,
        fileUrl: fileUrl, // 파일 URL 반환
      },
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: '파일 업로드 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};

// 파일 다운로드
exports.downloadFile = async (req, res) => {
  try {
    const { file } = await getFileFromRequest(req); // 파일 정보를 DB에서 조회
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `uploads/${file.filename}`,
    };

    const command = new GetObjectCommand(params);
    const data = await s3.send(command); // S3에서 파일 다운로드

    res.set({
      'Content-Type': file.mimetype,
      'Content-Length': file.size,
      'Content-Disposition': file.getContentDisposition('attachment'),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    data.Body.pipe(res); // 파일 데이터 스트리밍
  } catch (error) {
    handleFileError(error, res);
  }
};

// 파일 미리보기
exports.viewFile = async (req, res) => {
  try {
    const { file } = await getFileFromRequest(req);

    if (!file.isPreviewable()) {
      return res.status(415).json({
        success: false,
        message: '미리보기를 지원하지 않는 파일 형식입니다.',
      });
    }

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `uploads/${file.filename}`,
    };

    const command = new GetObjectCommand(params);
    const data = await s3.send(command); // S3에서 파일 미리보기

    // S3 파일 URL 생성
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/${file.filename}`;

    // 파일 URL을 응답에 포함
    res.set({
      'Content-Type': file.mimetype,
      'Content-Disposition': file.getContentDisposition('inline'),
      'Content-Length': file.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });

    // 스트리밍하는 동시에 URL도 반환
    res.json({
      success: true,
      message: '파일 미리보기 성공',
      fileUrl: fileUrl, // 반환할 URL 추가
    });

    // 스트리밍 데이터를 클라이언트로 전송
    // data.Body.pipe(res);
  } catch (error) {
    handleFileError(error, res);
  }
};

const handleFileError = (error, res) => {
  console.error('File operation error:', {
    message: error.message,
    stack: error.stack,
  });

  // 에러 상태 코드 및 메시지 매핑
  const errorResponses = {
    'Invalid filename': { status: 400, message: '잘못된 파일명입니다.' },
    'Authentication required': { status: 401, message: '인증이 필요합니다.' },
    'Invalid file path': { status: 400, message: '잘못된 파일 경로입니다.' },
    'File not found in database': {
      status: 404,
      message: '파일을 찾을 수 없습니다.',
    },
    'File message not found': {
      status: 404,
      message: '파일 메시지를 찾을 수 없습니다.',
    },
    'Unauthorized access': {
      status: 403,
      message: '파일에 접근할 권한이 없습니다.',
    },
    ENOENT: { status: 404, message: '파일을 찾을 수 없습니다.' },
  };

  const errorResponse = errorResponses[error.message] || {
    status: 500,
    message: '파일 처리 중 오류가 발생했습니다.',
  };

  res.status(errorResponse.status).json({
    success: false,
    message: errorResponse.message,
  });
};

// 파일 삭제
exports.deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.',
      });
    }

    if (file.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '파일을 삭제할 권한이 없습니다.',
      });
    }

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `uploads/${file.filename}`,
    };

    const command = new DeleteObjectCommand(params);
    await s3.send(command); // S3에서 파일 삭제

    await file.deleteOne(); // DB에서 파일 정보 삭제

    res.json({
      success: true,
      message: '파일이 삭제되었습니다.',
    });
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      message: '파일 삭제 중 오류가 발생했습니다.',
      error: error.message,
    });
  }
};
