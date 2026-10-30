import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ConfinedFileError } from "./confined-file.js";

const script = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module -Name ($PSHOME+'\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$request=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([Console]::ReadLine())
$compile=[string]$request.compile
try {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
  foreach($trusted in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new($trusted),
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  }
  if([IO.Directory]::Exists($compile) -or [IO.File]::Exists($compile)){throw 'file_unavailable'}
  [IO.DirectoryInfo]::new($compile).Create($acl)
  if(@([IO.Directory]::EnumerateFileSystemEntries($compile)).Length -ne 0){throw 'file_unavailable'}
  $actual=[IO.Directory]::GetAccessControl($compile)
  if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'file_denied'}
  foreach($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'file_denied'}
  }
  $env:TEMP=$compile;$env:TMP=$compile
  Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ConfinedArchive {
  [StructLayout(LayoutKind.Sequential)]
  struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;
    public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info value);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder path,uint size,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetFileType(SafeFileHandle h);
  static Exception Fail(string code) { return new IOException(code); }
  static Info Inspect(SafeFileHandle handle,string path,bool directory) {
    if(handle.IsInvalid) {
      int code=Marshal.GetLastWin32Error();
      throw Fail(code==2||code==3?"file_missing":code==32||code==33?"file_busy":"file_denied");
    }
    Info info;
    if(!GetFileInformationByHandle(handle,out info))throw Fail("file_unavailable");
    if((info.Attributes&0x400)!=0)throw Fail("file_denied");
    if(((info.Attributes&0x10)!=0)!=directory || GetFileType(handle)!=1)throw Fail("file_not_regular");
    var buffer=new StringBuilder(32768);
    uint length=GetFinalPathNameByHandleW(handle,buffer,32768,0);
    if(length==0||length>=32768||!String.Equals(buffer.ToString(),@"\\?\"+path,StringComparison.OrdinalIgnoreCase))
      throw Fail("file_denied");
    return info;
  }
  static Info GuardPath(string path,List<SafeFileHandle> handles) {
    string current=Path.GetPathRoot(path);
    var components=path.Substring(current.Length).Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries);
    for(int index=0;;index++) {
      var guard=CreateFileW(@"\\?\"+current,0x80,1,IntPtr.Zero,3,0x2200000,IntPtr.Zero);
      handles.Add(guard);
      Info info=Inspect(guard,current,true);
      if(index==components.Length)return info;
      current=Path.Combine(current,components[index]);
    }
  }
  static byte[] Read(string path,string authorizedRoot,int maximum) {
    path=Path.GetFullPath(path);
    authorizedRoot=Path.GetFullPath(authorizedRoot);
    string root=Path.GetPathRoot(path);
    var drive=new DriveInfo(root);
    if(drive.DriveType!=DriveType.Fixed&&drive.DriveType!=DriveType.Ram)throw Fail("file_denied");
    var handles=new List<SafeFileHandle>();
    try {
      Info authorizedInfo=GuardPath(authorizedRoot,handles);
      bool bound=false;
      string directory=root;
      var components=path.Substring(root.Length).Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries);
      for(int index=0;index<components.Length;index++) {
        // No write/delete sharing: ancestors cannot be renamed or changed to reparse points.
        var guard=CreateFileW(@"\\?\"+directory,0x80,1,IntPtr.Zero,3,0x2200000,IntPtr.Zero);
        handles.Add(guard);
        Info current=Inspect(guard,directory,true);
        if(String.Equals(directory,authorizedRoot,StringComparison.OrdinalIgnoreCase)) {
          if(current.Volume!=authorizedInfo.Volume||current.IndexHigh!=authorizedInfo.IndexHigh||current.IndexLow!=authorizedInfo.IndexLow)
            throw Fail("file_denied");
          bound=true;
        }
        directory=Path.Combine(directory,components[index]);
      }
      if(!bound)throw Fail("file_denied");
      var file=CreateFileW(@"\\?\"+path,0x80000000,1,IntPtr.Zero,3,0xA200000,IntPtr.Zero);
      handles.Add(file);
      Info before=Inspect(file,path,false);
      ulong size=((ulong)before.SizeHigh<<32)|before.SizeLow;
      if(before.Links!=1)throw Fail("file_not_regular");
      if(size>(ulong)maximum)throw Fail("file_too_large");
      byte[] bytes=new byte[(int)size];
      using(var stream=new FileStream(new SafeFileHandle(file.DangerousGetHandle(),false),FileAccess.Read)) {
        int position=0;
        while(position<bytes.Length) {
          int count=stream.Read(bytes,position,Math.Min(65536,bytes.Length-position));
          if(count==0)throw Fail("file_changed");
          position+=count;
        }
        if(stream.ReadByte()!=-1)throw Fail("file_changed");
      }
      Info after=Inspect(file,path,false);
      if(after.Links!=1||after.SizeHigh!=before.SizeHigh||after.SizeLow!=before.SizeLow||
        after.Write.dwHighDateTime!=before.Write.dwHighDateTime||after.Write.dwLowDateTime!=before.Write.dwLowDateTime)
        throw Fail("file_changed");
      return bytes;
    } finally {for(int i=handles.Count-1;i>=0;i--)handles[i].Dispose();}
  }
  public static void Emit(string path,string authorizedRoot,int maximum) {
    byte[] bytes=Read(path,authorizedRoot,maximum);
    using(var output=Console.OpenStandardOutput()) {
      output.Write(bytes,0,bytes.Length);
      output.Flush();
    }
  }
}
'@
  [ConfinedArchive]::Emit([string]$request.path,[string]$request.root,[int]$request.maximum)
} catch {
  $error_=$_.Exception
  while($null -ne $error_.InnerException){$error_=$error_.InnerException}
  $code=[string]$error_.Message
  if($code -notmatch '^file_(denied|missing|busy|not_regular|too_large|changed|unavailable)$'){$code='file_unavailable'}
  [Console]::Error.WriteLine($code)
  [Console]::Error.WriteLine($error_.ToString())
  exit 1
} finally {
  if([IO.Directory]::Exists($compile)){[IO.Directory]::Delete($compile,$true)}
}
`;
const bootstrap =
  "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$code=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()));& ([ScriptBlock]::Create($code))";

export async function readWindowsFile(
  path: string,
  root: string,
  maximum: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) throw new ConfinedFileError("file_unsupported");
  const parent = resolve(".cache");
  await mkdir(parent, { recursive: true });
  const owned = join(parent, `check-archive-${randomUUID()}`);
  await mkdir(owned, { mode: 0o700 });
  const compile = join(owned, "native");
  try {
    signal.throwIfAborted();
    const child = spawn(
      join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(bootstrap, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PSModulePath: "" },
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let failure: unknown;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopping ??= (async () => {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          try {
            await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              timeout: 5000,
            });
          } catch (error) {
            if (child.exitCode === null && child.signalCode === null) throw error;
          }
        }
      })();
      void stopping.catch((error) => {
        failure ??= error;
      });
    };
    const abort = () => {
      failure = signal.reason;
      stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      failure = new ConfinedFileError("file_unavailable");
      stop();
    }, 60000);
    try {
      const outcome = await new Promise<number | null>((done) => {
        child.once("error", (error) => {
          failure = error;
        });
        child.once("close", (code) => done(code));
        child.stdin.on("error", (error) => {
          failure ??= error;
          stop();
        });
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) {
            failure = new ConfinedFileError("file_too_large");
            stop();
          } else chunks.push(chunk);
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-4096);
        });
        child.stdin.end(
          `${Buffer.from(script).toString("base64")}\n${JSON.stringify({ path, root, maximum, compile })}\n`,
        );
        if (signal.aborted) abort();
      });
      await stopping;
      signal.throwIfAborted();
      if (failure) throw failure;
      if (outcome !== 0) {
        const code =
          /^file_(?:denied|missing|busy|not_regular|too_large|changed|unavailable)$/m.exec(
            stderr,
          )?.[0];
        throw new ConfinedFileError(code ?? "file_unavailable", { cause: new Error(stderr) });
      }
      return Buffer.concat(chunks, size);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}
