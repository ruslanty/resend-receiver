import { createApplicationServer } from "./src/bootstrap.js";

const { server, port } = createApplicationServer();
server.listen(port, "0.0.0.0", () => {
  console.log(`Resend Receiver listening on port ${server.address().port}`);
});
