import https from "https";
import fs from "fs";

https.get("https://ibb.co/0pZpvFC3", (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    const match = body.match(/https:\/\/i\.ibb\.co\/[^\"]+/);
    if (match) {
      console.log("FOUND_DIRECT_URL:", match[0]);
      // Download the direct image
      const file = fs.createWriteStream("attached_assets/generated_images/user_custom_bottle.png");
      https.get(match[0], (imgRes) => {
        imgRes.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log("DOWNLOAD_SUCCESSFUL");
        });
      });
    } else {
      console.log("NOT_FOUND", body.substring(0, 300));
    }
  });
});
