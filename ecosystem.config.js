module.exports = {
  apps: [
    {
      name: "cartenz-panel",
      script: "server.cjs",
      cwd: ".",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        PORT: process.env.PORT || 8080,
        SESSION_SECRET: process.env.SESSION_SECRET || "please_set_env"
      },
      out_file: "pm2-out.log",
      error_file: "pm2-error.log",
      time: true,
      max_memory_restart: "300M"
    }
  ]
};

