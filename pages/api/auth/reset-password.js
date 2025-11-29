import prisma from "../../../lib/prisma";
import bcrypt from "bcryptjs";
import runCors from "../../../lib/cors";

export default async function handler(req, res) {
  if (runCors(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { phoneNumber, resetToken, newPassword } = req.body;

    if (!phoneNumber || !resetToken || !newPassword) {
      return res.status(400).json({ 
        error: "Mohon lengkapi No HP, Token, dan Password Baru.",
        code: "MISSING_FIELDS"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        error: "Password baru minimal 6 karakter.",
        code: "WEAK_PASSWORD" 
      });
    }

    const user = await prisma.user.findFirst({
      where: { phoneNumber },
    });

    if (!user) {
      return res.status(404).json({ 
        error: "Nomor HP tidak ditemukan.", 
        code: "USER_NOT_FOUND" 
      });
    }

    if (!user.resetToken || !user.resetTokenExpiry) {
        return res.status(400).json({
            error: "Tidak ada permintaan reset password yang aktif untuk akun ini.",
            code: "NO_ACTIVE_REQUEST"
        });
    }

    if (user.resetToken !== resetToken) {
      return res.status(400).json({ 
        error: "Token reset salah atau tidak valid.", 
        code: "INVALID_TOKEN" 
      });
    }

    if (new Date() > new Date(user.resetTokenExpiry)) {
      return res.status(400).json({ 
        error: "Token reset sudah kadaluwarsa. Silakan minta ulang.", 
        code: "TOKEN_EXPIRED" 
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        resetToken: null,  
        resetTokenExpiry: null,
      },
    });

    return res.status(200).json({ 
      success: true, 
      message: "Password berhasil diubah. Silakan login kembali." 
    });

  } catch (error) {
    console.error("[Reset Password Error]:", error);
    
    return res.status(500).json({ 
      error: "Terjadi kesalahan sistem saat mereset password.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
}