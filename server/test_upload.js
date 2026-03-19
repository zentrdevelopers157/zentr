const fs = require('fs');
const path = require('path');

async function testUpload() {
  const FormData = require('form-data');
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  
  const form = new FormData();
  form.append('image', fs.createReadStream(path.join(__dirname, 'public/logo.png')));
  
  try {
    const res = await fetch('https://zentr.onrender.com/api/upload', {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    console.log('Upload response:', data);
    
    if (data.url) {
      const imgRes = await fetch('https://zentr.onrender.com' + data.url);
      console.log('Image fetch status:', imgRes.status);
    }
  } catch (err) {
    console.error(err);
  }
}

testUpload();
