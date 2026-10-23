import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { withFileMutex } from "./store-lock.js";

export interface PrivatePathProof {
  owner: string;
  currentUser: string;
  protected: boolean;
  allowed: string[];
}

const windowsCommand = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module -Name ($PSHOME+'\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$first=[Console]::ReadLine()
if($null -eq $first){exit}
$initial=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $first
$drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([string]$initial.directory))
if($drive.DriveType -notin @([IO.DriveType]::Fixed,[IO.DriveType]::Ram)){throw 'Host files require a local drive'}
$compileDirectory=[string]$initial.compileDirectory
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($compileDirectory)) > $null
if([IO.Directory]::Exists($compileDirectory) -or [IO.File]::Exists($compileDirectory)){throw 'Compiler directory already exists'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$security=[Security.AccessControl.DirectorySecurity]::new()
$security.SetOwner($sid)
$security.SetAccessRuleProtection($true,$false)
foreach($trusted in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
  $rule=[Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($trusted),
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($rule)
}
$compilerOwned=$false
try {
  [IO.DirectoryInfo]::new($compileDirectory).Create($security)
  $actual=[IO.Directory]::GetAccessControl($compileDirectory)
  if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Compiler directory is not private'}
  foreach($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'Compiler directory has untrusted access'}
  }
  $compilerOwned=$true
  $env:TEMP=$compileDirectory
  $env:TMP=$compileDirectory
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public sealed class PrivatePathException : Exception {
  public string Code;
  public PrivatePathException(string code) : base(code) { Code=code; }
}
public static class PrivateHostFiles {
  [StructLayout(LayoutKind.Sequential)]
  struct Attributes { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential)]
  struct Information {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
    public System.Runtime.InteropServices.ComTypes.FILETIME Access;
    public System.Runtime.InteropServices.ComTypes.FILETIME Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Disposition { [MarshalAs(UnmanagedType.Bool)] public bool Delete; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern bool CreateDirectoryW(string path, ref Attributes attributes);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security,
    uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, ref Attributes security,
    uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Information information);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetFileInformationByHandle(SafeFileHandle handle, int type, ref Disposition info, int size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern bool MoveFileExW(string source, string destination, uint flags);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint flags,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")]
  static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  const uint Read=0x80000000, Write=0x40000000, Control=0x20000, Delete=0x10000;
  const uint Reparse=0x200000, Backup=0x2000000;
  static readonly string Current=WindowsIdentity.GetCurrent().User.Value;
  static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
  public sealed class Proof {
    public string owner, currentUser;
    public bool protectedAcl;
    public string[] allowed;
  }
  static void NativeError(int code) {
    if(code==2 || code==3)throw new PrivatePathException("ENOENT");
    if(code==80 || code==183)throw new PrivatePathException("EEXIST");
    if(code==32 || code==33)throw new PrivatePathException("EBUSY");
    throw new PrivatePathException("EPRIVATE");
  }
  static void CheckHandle(SafeFileHandle handle) {
    if(handle.IsInvalid)NativeError(Marshal.GetLastWin32Error());
  }
  static byte[] Security(bool directory) {
    FileSystemSecurity security=directory?(FileSystemSecurity)new DirectorySecurity():new FileSecurity();
    security.SetOwner(new SecurityIdentifier(Current));
    security.SetAccessRuleProtection(true,false);
    foreach(string sid in new string[]{Current,"S-1-5-18","S-1-5-32-544"})
      security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),
        FileSystemRights.FullControl,directory?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None,
        PropagationFlags.None,AccessControlType.Allow));
    return security.GetSecurityDescriptorBinaryForm();
  }
  static Information Info(SafeFileHandle handle) {
    Information info;
    if(!GetFileInformationByHandle(handle,out info))NativeError(Marshal.GetLastWin32Error());
    return info;
  }
  static Proof Validate(SafeFileHandle handle, bool directory) {
    var path=new StringBuilder(32768);
    uint pathLength=GetFinalPathNameByHandleW(handle,path,32768,0);
    if(pathLength==0 || pathLength>=32768)throw new PrivatePathException("EPRIVATE");
    string final=path.ToString();
    if(!final.StartsWith(@"\\?\") || final.Length<7 || final[5]!=':' || final[6]!='\\')
      throw new PrivatePathException("EPRIVATE");
    var drive=new DriveInfo(final.Substring(4,3));
    if(drive.DriveType!=DriveType.Fixed && drive.DriveType!=DriveType.Ram)
      throw new PrivatePathException("EPRIVATE");
    var info=Info(handle);
    if((info.Attributes&0x400)!=0 || ((info.Attributes&0x10)!=0)!=directory ||
       (!directory && (info.Links!=1 || info.SizeHigh!=0 || info.SizeLow>16384)))
      throw new PrivatePathException("EPRIVATE");
    IntPtr owner,group,dacl,sacl,descriptor;
    uint error=GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor);
    if(error!=0)NativeError((int)error);
    try {
      uint length=GetSecurityDescriptorLength(descriptor);
      if(length==0 || length>65536)throw new PrivatePathException("EPRIVATE");
      byte[] bytes=new byte[length];Marshal.Copy(descriptor,bytes,0,(int)length);
      var security=new RawSecurityDescriptor(bytes,0);
      if(security.Owner==null || security.Owner.Value!=Current ||
         security.DiscretionaryAcl==null ||
         (security.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0)
        throw new PrivatePathException("EPRIVATE");
      bool full=false;
      var allowed=new List<string>();
      foreach(GenericAce entry in security.DiscretionaryAcl) {
        var ace=entry as CommonAce;
        if(ace==null || ace.IsCallback || ace.AceQualifier!=AceQualifier.AccessAllowed ||
           (ace.SecurityIdentifier.Value!=Current && ace.SecurityIdentifier.Value!="S-1-5-18" &&
            ace.SecurityIdentifier.Value!="S-1-5-32-544"))
          throw new PrivatePathException("EPRIVATE");
        allowed.Add(ace.SecurityIdentifier.Value);
        if(ace.SecurityIdentifier.Value==Current && (ace.AceFlags&AceFlags.InheritOnly)==0 &&
           (ace.AccessMask&0x1f01ff)==0x1f01ff)full=true;
      }
      if(!full)throw new PrivatePathException("EPRIVATE");
      return new Proof{owner=security.Owner.Value,currentUser=Current,protectedAcl=true,allowed=allowed.ToArray()};
    } finally { LocalFree(descriptor); }
  }
  static SafeFileHandle DirectoryHandle(string path) {
    var drive=new DriveInfo(Path.GetPathRoot(path));
    if(drive.DriveType!=DriveType.Fixed && drive.DriveType!=DriveType.Ram)
      throw new PrivatePathException("EPRIVATE");
    var handle=CreateFileW(path,Control|0x80,3,IntPtr.Zero,3,Backup|Reparse,IntPtr.Zero);
    CheckHandle(handle);
    try {Validate(handle,true);ValidateChildren(path);return handle;} catch {handle.Dispose();throw;}
  }
  static void ValidateChildren(string path) {
    int count=0;
    foreach(string entry in System.IO.Directory.EnumerateFileSystemEntries(path)) {
      if(++count>64)throw new PrivatePathException("EPRIVATE");
      string name=Path.GetFileName(entry);
      if(name.EndsWith(".json",StringComparison.OrdinalIgnoreCase) || String.Equals(name,"private-store.lock",StringComparison.OrdinalIgnoreCase)) {
        using(var file=CreateFileW(entry,Control|0x80,3,IntPtr.Zero,3,Reparse,IntPtr.Zero)) {
          try {CheckHandle(file);}
          catch(PrivatePathException error) {
            if(error.Code=="ENOENT")throw new PrivatePathException("EBUSY");
            throw;
          }
          Validate(file,false);
        }
      }
    }
  }
  public static Proof Directory(string path) {
    var drive=new DriveInfo(Path.GetPathRoot(path));
    if(drive.DriveType!=DriveType.Fixed && drive.DriveType!=DriveType.Ram)
      throw new PrivatePathException("EPRIVATE");
    System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path));
    var bytes=Security(true);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
    try {
      var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};
      if(!CreateDirectoryW(path,ref attributes)) {
        int error=Marshal.GetLastWin32Error();if(error!=183)NativeError(error);
      }
    } finally {pin.Free();}
    using(var handle=DirectoryHandle(path))return Validate(handle,true);
  }
  static string Child(string root,string name) {
    if(String.IsNullOrEmpty(name) || name=="." || name==".." ||
       name.IndexOfAny(new char[]{'\\','/',':'})>=0)
      throw new PrivatePathException("EPRIVATE");
    return Path.Combine(root,name);
  }
  static SafeFileHandle FileHandle(string path,bool delete) {
    var handle=CreateFileW(path,Read|Control|(delete?Delete:0),1,IntPtr.Zero,3,Reparse,IntPtr.Zero);
    CheckHandle(handle);
    try {Validate(handle,false);return handle;} catch {handle.Dispose();throw;}
  }
  static string Contents(SafeFileHandle handle) {
    using(var stream=new FileStream(handle,FileAccess.Read))
    using(var reader=new StreamReader(stream,Utf8,false,4096))return reader.ReadToEnd();
  }
  public static string ReadFile(string root,string name) {
    using(var directory=DirectoryHandle(root))
    using(var file=FileHandle(Child(root,name),false))return Contents(file);
  }
  public static Proof FileProof(string root,string name) {
    using(var directory=DirectoryHandle(root))
    using(var file=FileHandle(Child(root,name),false))return Validate(file,false);
  }
  static SafeFileHandle Guard(string root) {
    var bytes=Security(false);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
    SafeFileHandle file;
    try {
      var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};
      file=CreateFileW(Child(root,"private-store.lock"),Read|Write|Control,0,ref attributes,4,Reparse,IntPtr.Zero);
      CheckHandle(file);
    } finally {pin.Free();}
    try {Validate(file,false);return file;}catch{file.Dispose();throw;}
  }
  static void CreateCore(string root,string name,string text) {
    byte[] content=Utf8.GetBytes(text);
    if(content.Length>16384)throw new PrivatePathException("EPRIVATE");
      var bytes=Security(false);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
      SafeFileHandle file;
      try {
        var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};
        file=CreateFileW(Child(root,name),Read|Write|Control|Delete,1,ref attributes,1,Reparse,IntPtr.Zero);
        CheckHandle(file);
      } finally {pin.Free();}
      using(file) {
        try {
          Validate(file,false);
          using(var stream=new FileStream(new SafeFileHandle(file.DangerousGetHandle(),false),FileAccess.Write)) {
            stream.Write(content,0,content.Length);stream.Flush(true);
          }
        } catch {
          var disposition=new Disposition{Delete=true};
          if(!SetFileInformationByHandle(file,4,ref disposition,Marshal.SizeOf(typeof(Disposition))))
            NativeError(Marshal.GetLastWin32Error());
          throw;
        }
      }
  }
  public static void Create(string root,string name,string text) {
    using(var directory=DirectoryHandle(root))
    using(var guard=Guard(root))CreateCore(root,name,text);
  }
  static bool RemoveCore(string root,string name,string expected) {
      var path=Child(root,name);
      using(var file=FileHandle(path,true)) {
        if(expected!=null) {
          // Reading must not dispose the handle before disposition is applied.
          using(var stream=new FileStream(new SafeFileHandle(file.DangerousGetHandle(),false),FileAccess.Read))
          using(var reader=new StreamReader(stream,Utf8,false,4096))
            if(reader.ReadToEnd()!=expected)return false;
        }
        var disposition=new Disposition{Delete=true};
        if(!SetFileInformationByHandle(file,4,ref disposition,Marshal.SizeOf(typeof(Disposition))))
          NativeError(Marshal.GetLastWin32Error());
        return true;
      }
  }
  public static bool Remove(string root,string name,string expected) {
    using(var directory=DirectoryHandle(root))
    using(var guard=Guard(root))return RemoveCore(root,name,expected);
  }
  public static bool Publish(string root,string name,string temporary,string text,string expected,bool hasExpected,bool expectAbsent) {
    using(var directory=DirectoryHandle(root))
    using(var guard=Guard(root)) {
      string before=null;
      try {before=ReadFile(root,name);}
      catch(PrivatePathException error) {if(error.Code!="ENOENT")throw;}
      if(hasExpected && (expectAbsent?before!=null:before!=expected))return false;
      CreateCore(root,temporary,text);
      try {
        for(int n=0;;n++) {
          if(MoveFileExW(Child(root,temporary),Child(root,name),9))break;
          int error=Marshal.GetLastWin32Error();
          if((error!=32 && error!=33)||n>=99)NativeError(error);
          System.Threading.Thread.Sleep(10);
        }
        using(var published=FileHandle(Child(root,name),false)){}
      } finally {
        try {RemoveCore(root,temporary,text);}catch(PrivatePathException error) {if(error.Code!="ENOENT")throw;}
      }
      return true;
    }
  }
}
'@
} finally {
  if($compilerOwned -and [IO.Directory]::Exists($compileDirectory)){[IO.Directory]::Delete($compileDirectory,$true)}
}
$line=$first
$first=$null
$initial=$null
while($null -ne $line) {
  try {
    $request=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $line
    $value=$null
    switch($request.op) {
      'directory' {$value=[PrivateHostFiles]::Directory($request.directory)}
      'read' {$value=[PrivateHostFiles]::ReadFile($request.directory,$request.name)}
      'proof' {$value=[PrivateHostFiles]::FileProof($request.directory,$request.name)}
      'create' {[PrivateHostFiles]::Create($request.directory,$request.name,$request.text)}
      'publish' {$value=[PrivateHostFiles]::Publish($request.directory,$request.name,$request.temporary,$request.text,[string]$request.expected,[bool]$request.hasExpected,[bool]$request.expectAbsent)}
      'remove' {$expected=$null;if($request.hasExpected){$expected=[string]$request.expected};$value=[PrivateHostFiles]::Remove($request.directory,$request.name,$expected)}
      default {throw 'Invalid private file operation'}
    }
    $response=@{id=$request.id;ok=$true;value=$value}
  } catch {
    $error_=$_.Exception
    while($null -ne $error_.InnerException){$error_=$error_.InnerException}
    $code='EPRIVATE'
    if($error_.GetType().FullName -eq 'PrivatePathException'){$code=$error_.Code}
    $response=@{id=$request.id;ok=$false;code=$code}
  }
  [Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -Depth 8 -InputObject $response))
  $response=$null;$value=$null;$request=$null;$expected=$null
  $line=[Console]::ReadLine()
}
`;
const bootstrap =
  "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$code=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()));& ([ScriptBlock]::Create($code))";

let helper: ChildProcessWithoutNullStreams | undefined;
let serial: Promise<unknown> = Promise.resolve();
let buffered = "";
let reply: ((line: string) => void) | undefined;
let failed: ((error: Error) => void) | undefined;
function privacyError(code = "EPRIVATE") {
  return Object.assign(
    new Error(`Private Host file operation failed (${code}); no insecure fallback is permitted.`),
    { code },
  );
}
function startHelper() {
  if (helper) return helper;
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) throw privacyError();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(bootstrap, "utf16le").toString("base64"),
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PSModulePath: "" },
      },
    );
  } catch {
    throw privacyError();
  }
  helper = child;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    if (buffered.length > 128 * 1024) {
      stop();
      child.kill();
      return;
    }
    const end = buffered.indexOf("\n");
    if (end >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      reply?.(line);
    }
  });
  child.stderr.resume();
  const stop = () => {
    if (helper !== child) return;
    helper = undefined;
    buffered = "";
    failed?.(privacyError());
  };
  child.once("error", stop);
  child.once("close", stop);
  child.stdin.on("error", stop);
  const exit = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  process.once("exit", exit);
  child.once("close", () => process.removeListener("exit", exit));
  child.stdin.write(`${Buffer.from(windowsCommand, "utf8").toString("base64")}\n`);
  return child;
}
function refs(child: ChildProcessWithoutNullStreams, active: boolean) {
  const method = active ? "ref" : "unref";
  child[method]();
  for (const stream of [child.stdin, child.stdout, child.stderr])
    (stream as unknown as { ref(): void; unref(): void })[method]();
}
function windows<T>(request: Record<string, unknown>): Promise<T> {
  const task = serial.then(
    () =>
      new Promise<T>((resolveReply, reject) => {
        const child = startHelper();
        const id = randomUUID();
        let settled = false;
        refs(child, true);
        const finish = (error?: Error, value?: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reply = undefined;
          failed = undefined;
          refs(child, false);
          if (error) reject(error);
          else resolveReply(value as T);
        };
        const stop = () => {
          if (helper === child) {
            helper = undefined;
            buffered = "";
          }
          child.kill();
          finish(privacyError());
        };
        const timer = setTimeout(stop, 15_000);
        failed = (error) => finish(error);
        reply = (line) => {
          try {
            const response = JSON.parse(line) as {
              id: string;
              ok: boolean;
              value: T;
              code?: string;
            };
            if (response.id !== id) throw privacyError();
            if (!response.ok) finish(privacyError(response.code));
            else finish(undefined, response.value);
          } catch {
            stop();
          }
        };
        child.stdin.write(
          `${JSON.stringify({ ...request, id, compileDirectory: join(dirname(String(request.directory)), `.check-host-security-${randomUUID()}`) })}\n`,
        );
      }),
  );
  serial = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
export async function closePrivateFileBackend(): Promise<void> {
  await serial;
  const child = helper;
  if (!child) return;
  helper = undefined;
  refs(child, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((done) => {
      child.once("close", () => done());
      timer = setTimeout(() => child.kill(), 1000);
      child.stdin.end();
    });
  } finally {
    clearTimeout(timer);
    refs(child, false);
  }
}

export async function ensurePrivateDirectory(
  directory: string,
): Promise<PrivatePathProof | undefined> {
  directory = resolve(directory);
  if (process.platform === "win32") {
    if (!/^[A-Za-z]:\\/.test(directory)) throw privacyError();
    const proof = await retryBusy(() =>
      windows<{ owner: string; currentUser: string; protectedAcl: boolean; allowed: string[] }>({
        op: "directory",
        directory,
      }),
    );
    return { ...proof, protected: proof.protectedAcl };
  }
  await mkdir(dirname(directory), { recursive: true });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    (stat.mode & 0o700) !== 0o700
  )
    throw privacyError();
  await retryBusy(() => validatePosixMetadata(directory));
}
async function validatePosixMetadata(directory: string): Promise<void> {
  const names = await readdir(directory);
  if (names.length > 64) throw privacyError();
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".json") && name !== "private-store.lock") continue;
    if (name === "private-store.lock") {
      // Closing another descriptor for this inode would release this process's POSIX locks.
      const value = await lstat(childPath(directory, name));
      if (
        !value.isFile() ||
        value.nlink !== 1 ||
        value.uid !== process.getuid?.() ||
        value.mode & 0o077 ||
        value.size > 16384
      )
        throw privacyError();
      continue;
    }
    let file: FileHandle;
    try {
      file = await open(childPath(directory, name), constants.O_NOFOLLOW | constants.O_RDONLY);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw privacyError("EBUSY");
      throw error;
    }
    try {
      const value = await file.stat();
      // Publication may replace/unlink a descriptor after readdir or open.
      if (value.nlink === 0) throw privacyError("EBUSY");
      if (
        !value.isFile() ||
        value.nlink !== 1 ||
        value.uid !== process.getuid?.() ||
        value.mode & 0o077 ||
        value.size > 16384
      )
        throw privacyError();
    } finally {
      await file.close();
    }
  }
}
export async function createPrivateDirectory(parent: string, prefix: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(prefix)) throw privacyError();
  if (process.platform !== "win32") await mkdir(parent, { recursive: true });
  const directory = join(parent, `${prefix}${randomUUID()}`);
  await ensurePrivateDirectory(directory);
  return directory;
}
function childPath(directory: string, name: string) {
  if (!name || name === "." || name === ".." || /[\\/:]/.test(name)) throw privacyError();
  return join(directory, name);
}
async function posixMutation<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await ensurePrivateDirectory(directory);
  const path = childPath(directory, "private-store.lock");
  try {
    const file = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await file.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await ensurePrivateDirectory(directory);
  return withFileMutex(path, operation);
}
async function posixFile(directory: string, name: string, create = false) {
  if (name === "private-store.lock") throw privacyError();
  await ensurePrivateDirectory(directory);
  const handle = await open(
    childPath(directory, name),
    constants.O_NOFOLLOW |
      (create ? constants.O_CREAT | constants.O_EXCL | constants.O_RDWR : constants.O_RDONLY),
    0o600,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077 ||
      stat.size > 16384
    )
      throw privacyError();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function readPrivateFile(directory: string, name: string): Promise<string> {
  childPath(directory, name);
  if (process.platform === "win32")
    return windows({ op: "read", directory: resolve(directory), name });
  const handle = await posixFile(directory, name);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
export async function createPrivateFile(
  directory: string,
  name: string,
  text: string,
): Promise<void> {
  childPath(directory, name);
  if (Buffer.byteLength(text) > 16384) throw privacyError();
  if (process.platform === "win32")
    return windows({ op: "create", directory: resolve(directory), name, text });
  return posixMutation(directory, () => createPosixFile(directory, name, text));
}
async function createPosixFile(directory: string, name: string, text: string): Promise<void> {
  const handle = await posixFile(directory, name, true);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function publishPrivateFile(
  directory: string,
  name: string,
  text: string,
  expected?: string | null,
): Promise<boolean> {
  childPath(directory, name);
  const temporary = `publication-${randomUUID()}.json`;
  if (process.platform === "win32")
    return retryBusy(() =>
      windows({
        op: "publish",
        directory: resolve(directory),
        name,
        temporary,
        text,
        hasExpected: expected !== undefined,
        expectAbsent: expected === null,
        expected,
      }),
    );
  return posixMutation(directory, async () => {
    let before: string | undefined;
    try {
      before = await readPrivateFile(directory, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (expected !== undefined && (expected === null ? before !== undefined : before !== expected))
      return false;
    if (Buffer.byteLength(text) > 16384) throw privacyError();
    await createPosixFile(directory, temporary, text);
    try {
      await rename(childPath(directory, temporary), childPath(directory, name));
      await readPrivateFile(directory, name);
    } finally {
      await unlink(childPath(directory, temporary)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return true;
  });
}
export async function removePrivateFile(
  directory: string,
  name: string,
  expected?: string,
): Promise<boolean> {
  childPath(directory, name);
  try {
    if (process.platform === "win32")
      return await retryBusy(() =>
        windows({
          op: "remove",
          directory: resolve(directory),
          name,
          hasExpected: expected !== undefined,
          expected,
        }),
      );
    return await posixMutation(directory, async () => {
      if (expected !== undefined && (await readPrivateFile(directory, name)) !== expected)
        return false;
      const handle = await posixFile(directory, name);
      await handle.close();
      await unlink(childPath(directory, name));
      return true;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function retryBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt >= 39) throw error;
      await new Promise((done) => setTimeout(done, 25));
    }
  }
}
export async function privateFileProof(directory: string, name: string): Promise<PrivatePathProof> {
  if (process.platform !== "win32") {
    if (name === "private-store.lock") {
      await ensurePrivateDirectory(directory);
      const stat = await lstat(childPath(directory, name));
      return {
        owner: String(stat.uid),
        currentUser: String(process.getuid?.()),
        protected: (stat.mode & 0o077) === 0,
        allowed: [String(stat.uid)],
      };
    }
    const handle = await posixFile(directory, name);
    try {
      const stat = await handle.stat();
      return {
        owner: String(stat.uid),
        currentUser: String(process.getuid?.()),
        protected: (stat.mode & 0o077) === 0,
        allowed: [String(stat.uid)],
      };
    } finally {
      await handle.close();
    }
  }
  const proof = await windows<{
    owner: string;
    currentUser: string;
    protectedAcl: boolean;
    allowed: string[];
  }>({ op: "proof", directory: resolve(directory), name });
  return { ...proof, protected: proof.protectedAcl };
}
