import prisma from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import runCors from '../../../lib/cors';
import { generateTokens } from '../../../lib/jwt';

export default async function handler(req, res) {
  if (runCors(req, res)) return;

  if (req.method !== 'POST') return res.status(405).end();

  const { 
    firstName, lastName, email, birthDate, phoneNumber, password 
  } = req.body;

  if (!firstName || !lastName || !email || !password || !phoneNumber || !birthDate) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phoneNumber }] }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email or Phone Number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        firstName, lastName, email, phoneNumber,
        birthDate: new Date(birthDate),
        passwordHash: hashedPassword,
        avatarGender: "MALE",
        equippedTop: "starter_hair",
        equippedShirt: "starter_shirt",
        equippedPants: "starter_pants",
        equippedShoes: "starter_shoes"
      }
    });

    const { accessToken, refreshToken } = generateTokens(newUser.id);

    await prisma.user.update({
      where: { id: newUser.id },
      data: { refreshToken }
    });

    res.status(201).json({ 
      message: 'User created successfully', 
      accessToken, 
      refreshToken,
      user: {
        id: newUser.id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email
      }
    });

  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
}