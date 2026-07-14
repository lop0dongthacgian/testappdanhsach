// api/proxy.js
// Vercel Serverless Function: đóng vai trò trung gian giữa trình duyệt
// và Google Apps Script Web App. Link Apps Script thật KHÔNG nằm trong
// mã nguồn, mà được đọc từ biến môi trường GOOGLE_SHEET_API_URL,
// do đó không ai xem "View Page Source" mà lấy được link Google Sheet.

export default async function handler(req, res) {
  // Chỉ chấp nhận POST, giống như app đang dùng
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }

  const API_URL = process.env.GOOGLE_SHEET_API_URL;

  if (!API_URL) {
    res.status(500).json({
      success: false,
      message:
        "Server chưa cấu hình GOOGLE_SHEET_API_URL. Vào Vercel > Settings > Environment Variables để thêm.",
    });
    return;
  }

  try {
    const upstream = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();

    // Apps Script luôn trả JSON, cố gắng parse; nếu lỗi thì trả nguyên văn để dễ debug
    try {
      const data = JSON.parse(text);
      res.status(200).json(data);
    } catch {
      res.status(200).send(text);
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Lỗi kết nối tới Google Apps Script: " + err.message,
    });
  }
}
