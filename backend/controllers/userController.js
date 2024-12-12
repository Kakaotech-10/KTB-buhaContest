const bcrypt = require('bcryptjs');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3'); // v3 클라이언트
const User = require('../models/User');
const { upload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs').promises;

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// 회원가입
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 입력값 검증
    const validationErrors = [];

    if (!name || name.trim().length === 0) {
      validationErrors.push({
        field: 'name',
        message: '이름을 입력해주세요.',
      });
    } else if (name.length < 2) {
      validationErrors.push({
        field: 'name',
        message: '이름은 2자 이상이어야 합니다.',
      });
    }

    if (!email) {
      validationErrors.push({
        field: 'email',
        message: '이메일을 입력해주세요.',
      });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push({
        field: 'email',
        message: '올바른 이메일 형식이 아닙니다.',
      });
    }

    if (!password) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호를 입력해주세요.',
      });
    } else if (password.length < 6) {
      validationErrors.push({
        field: 'password',
        message: '비밀번호는 6자 이상이어야 합니다.',
      });
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors,
      });
    }

    // 사용자 중복 확인
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.',
      });
    }

    // 비밀번호 암호화 및 사용자 생성
    const newUser = new User({
      name,
      email,
      password,
      profileImage: '', // 기본 프로필 이미지 없음
    });

    const salt = await bcrypt.genSalt(10);
    newUser.password = await bcrypt.hash(password, salt);
    await newUser.save();

    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        profileImage: newUser.profileImage,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: '회원가입 처리 중 오류가 발생했습니다.',
    });
  }
};

// 프로필 조회
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 조회 중 오류가 발생했습니다.',
    });
  }
};

exports.updateProfile = async (req, res) => {
  //try
  {
    const { name, currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 이름 변경 처리
    if (name && name.trim()) {
      user.name = name.trim();
    }

    // 비밀번호 변경 처리
    if (currentPassword && newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: '새 비밀번호는 6자 이상이어야 합니다.',
        });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: '현재 비밀번호가 일치하지 않습니다.',
        });
      }

      user.password = await bcrypt.hash(newPassword, 10); // 비밀번호 암호화
    }

    await user.save();

    res.json({
      success: true,
      message: '프로필이 업데이트되었습니다.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  }
  // catch (error) {
  //   console.error('Update profile error:', error);
  //   res.status(500).json({
  //     success: false,
  //     message: '프로필 업데이트 중 오류가 발생했습니다.',
  //   });
  // }
};

// 프로필 이미지 업로드
exports.uploadProfileImage = async (req, res) => {
  try {
    //console.log(req);
    // 파일 업로드를 처리하는 미들웨어 사용
    upload.single('profileImage')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || '파일 업로드 중 오류가 발생했습니다.',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: '이미지가 제공되지 않았습니다.',
        });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.',
        });
      }

      user.profileImage = req.file.s3.url; // S3 URL 저장
      await user.save();

      res.json({
        success: true,
        message: '프로필 이미지가 업데이트되었습니다.',
        imageUrl: user.profileImage,
      });
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({
      success: false,
      message: '이미지 업로드 중 오류가 발생했습니다.',
    });
  }
};

// 프로필 이미지 삭제
exports.deleteProfileImage = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    if (user.profileImage) {
      // S3에서 기존 이미지 삭제
      const imageKey = user.profileImage.split('/').pop(); // S3 URL에서 파일명 추출
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `uploads/${imageKey}`,
      };

      await s3.send(new DeleteObjectCommand(params)); // v3 방식

      user.profileImage = ''; // 데이터베이스에서 이미지 URL 삭제
      await user.save();
    }

    res.json({
      success: true,
      message: '프로필 이미지가 삭제되었습니다.',
    });
  } catch (error) {
    console.error('Delete profile image error:', error);
    res.status(500).json({
      success: false,
      message: '프로필 이미지 삭제 중 오류가 발생했습니다.',
    });
  }
};

// 회원 탈퇴
exports.deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    // 프로필 이미지가 있다면 삭제
    if (user.profileImage) {
      const imagePath = path.join(__dirname, '..', user.profileImage);
      try {
        await fs.access(imagePath);
        await fs.unlink(imagePath);
      } catch (error) {
        console.error('Profile image delete error:', error);
      }
    }

    await user.deleteOne();

    res.json({
      success: true,
      message: '회원 탈퇴가 완료되었습니다.',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: '회원 탈퇴 처리 중 오류가 발생했습니다.',
    });
  }
};

module.exports = exports;
