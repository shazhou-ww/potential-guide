exports.execute = async subject => ({
  status: 200,
  payload: { ok: subject.ready, problems: subject.ready ? [] : [{ id: "not-ready", parameters: {} }] },
  message: "",
});
