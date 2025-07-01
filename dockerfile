# ใช้ Node.js official image เป็น Base Image
FROM node:20-alpine

# กำหนด Working Directory ภายใน Container
WORKDIR /app

# คัดลอก package.json และ package-lock.json (หรือ yarn.lock) ไปยัง Working Directory
# เพื่อให้ Docker สามารถติดตั้ง dependencies ได้อย่างมีประสิทธิภาพ
COPY package*.json ./

# ติดตั้ง dependencies ของโปรเจกต์
RUN npm install

# คัดลอกไฟล์และโฟลเดอร์ที่เหลือทั้งหมดของโปรเจกต์ไปยัง Working Directory
COPY . .

# บอก Container ว่าจะเปิด Port อะไร (ควรตรงกับ PORT ที่ app ของคุณ listen)
# แต่ Render จะกำหนด PORT ผ่าน Environment Variable ให้ App ของคุณเอง
# ดังนั้นบรรทัดนี้ส่วนใหญ่จะเป็นข้อมูลเฉยๆ แต่มีประโยชน์ในการทำงานของ Docker บางอย่าง
EXPOSE 3000

# คำสั่งที่ใช้ในการรันแอปพลิเคชันเมื่อ Container ถูก Start
# ต้องตรงกับ "start" script ใน package.json ของคุณ
CMD ["npm", "start"]