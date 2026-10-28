exports.execute = async (subject) => {
  const ready = require("node:fs").existsSync(subject.marker);
  return {
    status: 200,
    payload: ready
      ? { ok: true, problems: [] }
      : { ok: false, problems: [{ kind: "internal", id: "not-ready", parameters: {} }] },
    message: "Deployment fixture completed.",
  };
};
