export function dependencyWorker(objectiveId: string, projection = "subject") {
  return `exports.execute = async (subject, context) => {
    const requirement = {objectiveId:${JSON.stringify(objectiveId)},subject:${projection},expectedLevelId:"terminal"};
    const resolution = (context.data.resolutions ?? []).find(entry =>
      entry.requirement.objectiveId === requirement.objectiveId &&
      entry.requirement.expectedLevelId === requirement.expectedLevelId &&
      JSON.stringify(entry.requirement.subject) === JSON.stringify(requirement.subject));
    return {status:200,message:"",payload:resolution?.result ?? {ok:false,problems:[],requirements:[requirement]}};
  };`;
}

export const waitingWorker = `exports.execute = async (subject, context) => {
  await new Promise(resolve => {
    context.signal.addEventListener("abort", resolve, {once:true});
    context.defer(() => context.signal.removeEventListener("abort", resolve));
    if(context.signal.aborted) resolve();
  });
  return {status:200,message:"",payload:{ok:true,problems:[]}};
};`;

export function ownedChildWorker(pidFile?: string) {
  return `exports.execute = async (subject, context) => {
    const {spawn} = require("node:child_process");
    const {writeFileSync} = require("node:fs");
    const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",detached:process.platform!=="win32"});
    writeFileSync(${pidFile === undefined ? "subject.pidFile" : JSON.stringify(pidFile)},String(child.pid));
    await new Promise((resolve,reject) => {
      const abort=()=>child.kill("SIGKILL");
      context.signal.addEventListener("abort",abort,{once:true});
      context.defer(()=>context.signal.removeEventListener("abort",abort));
      child.once("error",reject); child.once("close",resolve);
      if(context.signal.aborted) abort();
    });
    return {status:200,message:"",payload:{ok:true,problems:[]}};
  };`;
}
