$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class KosworkNative {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiThread { public uint size,flags; public IntPtr active,focus,capture,menuOwner,moveSize,caret; public Rect caretRect; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiThread info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeoutW(IntPtr h,uint message,UIntPtr value,IntPtr flags,uint options,uint timeout,out UIntPtr result);
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint size,time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint f, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard key; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union data; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, Input[] values, int size);
  static Input Key(ushort vk, ushort scan, uint flags) { return new Input { type=1, data=new Union { key=new Keyboard { vk=vk, scan=scan, flags=flags } } }; }
  public static uint InputTick() {
    LastInput input=new LastInput{size=(uint)Marshal.SizeOf(typeof(LastInput))};
    if(!GetLastInputInfo(ref input)) throw new Exception("COMPUTER_INPUT_STATE_UNAVAILABLE");
    return input.time;
  }
  public static void Ready(string expected,string tick) {
    if(SetThreadDpiAwarenessContext(new IntPtr(-4))==IntPtr.Zero) throw new Exception("COMPUTER_DPI_CONTEXT_UNAVAILABLE");
    IntPtr d=OpenInputDesktop(0,false,0x0100);
    if(d==IntPtr.Zero) throw new Exception("COMPUTER_DESKTOP_UNAVAILABLE");
    CloseDesktop(d);
    if(!String.IsNullOrEmpty(expected) && GetForegroundWindow().ToInt64().ToString()!=expected) throw new Exception("COMPUTER_WINDOW_CHANGED");
    if(!String.IsNullOrEmpty(tick) && InputTick().ToString()!=tick) throw new Exception("COMPUTER_USER_INPUT_ACTIVE");
    foreach(int k in new int[]{1,2,16,17,18,91,92}) if(GetAsyncKeyState(k)<0) throw new Exception("COMPUTER_USER_INPUT_ACTIVE");
  }
  public static Input[] ReleaseInputs(Input[] submitted,uint inserted) {
    var held=new List<Input>(); bool left=false,right=false;
    for(int i=0;i<Math.Min(inserted,(uint)submitted.Length);i++) {
      Input input=submitted[i];
      if(input.type==1) {
        for(int j=held.Count-1;j>=0;j--) if(held[j].data.key.vk==input.data.key.vk && held[j].data.key.scan==input.data.key.scan && (held[j].data.key.flags&4)==(input.data.key.flags&4)) held.RemoveAt(j);
        if((input.data.key.flags&2)==0) held.Add(input);
      } else if(input.type==0) {
        uint f=input.data.mouse.flags;
        if((f&2)!=0) left=true; if((f&4)!=0) left=false;
        if((f&8)!=0) right=true; if((f&16)!=0) right=false;
      }
    }
    var release=new List<Input>();
    if(left) release.Add(new Input{data=new Union{mouse=new Mouse{flags=4}}});
    if(right) release.Add(new Input{data=new Union{mouse=new Mouse{flags=16}}});
    for(int i=held.Count-1;i>=0;i--) release.Add(Key(held[i].data.key.vk,held[i].data.key.scan,held[i].data.key.flags|2));
    return release.ToArray();
  }
  static void Send(Input[] a) {
    uint inserted=SendInput((uint)a.Length,a,Marshal.SizeOf(typeof(Input)));
    if(inserted==a.Length) return;
    // Best-effort release only inputs that this failed batch actually inserted.
    // Never retry the original action: its effect can already be partial.
    Input[] release=ReleaseInputs(a,inserted);
    if(release.Length>0) SendInput((uint)release.Length,release,Marshal.SizeOf(typeof(Input)));
    throw new Exception("COMPUTER_INPUT_REJECTED");
  }
  public static void Focus(IntPtr h) {
    uint p=0;
    uint thread=GetCurrentThreadId();
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out p);
    uint target=GetWindowThreadProcessId(h,out p);
    bool linkedForeground=thread!=foreground && AttachThreadInput(thread,foreground,true);
    bool linkedTarget=thread!=target && target!=foreground && AttachThreadInput(thread,target,true);
    try {
      if(IsIconic(h)) ShowWindowAsync(h,9);
      BringWindowToTop(h);
      SetForegroundWindow(h);
    } finally {
      if(linkedTarget) AttachThreadInput(thread,target,false);
      if(linkedForeground) AttachThreadInput(thread,foreground,false);
    }
    if(GetForegroundWindow()!=h) throw new Exception("COMPUTER_FOCUS_REJECTED");
  }
  public static string Text(string text,string expected,string expectedTick) {
    // Some native edit controls lose non-ASCII VK_PACKET characters. Probe the
    // documented UTF-32 message without inserting anything; use it only when the
    // currently focused child explicitly advertises support. No clipboard access.
    GuiThread gui=new GuiThread{size=(uint)Marshal.SizeOf(typeof(GuiThread))};
    UIntPtr answer;
    IntPtr foreground=String.IsNullOrEmpty(expected)?GetForegroundWindow():new IntPtr(Int64.Parse(expected));
    string inputTick=String.IsNullOrEmpty(expectedTick)?InputTick().ToString():expectedTick;
    Ready(foreground.ToInt64().ToString(),inputTick);
    if(GetGUIThreadInfo(0,ref gui) && gui.focus!=IntPtr.Zero &&
       GetAncestor(gui.focus,3)==GetAncestor(foreground,3) &&
       SendMessageTimeoutW(gui.focus,0x0109,new UIntPtr(0xffff),new IntPtr(1),0x22,500,out answer)!=IntPtr.Zero && answer.ToUInt64()==1) {
      int delivered=0;
      try {
        for(int i=0;i<text.Length;i++) {
          Ready(foreground.ToInt64().ToString(),inputTick);
          GuiThread current=new GuiThread{size=(uint)Marshal.SizeOf(typeof(GuiThread))};
          if(!GetGUIThreadInfo(0,ref current) || current.focus!=gui.focus) throw new Exception("COMPUTER_WINDOW_CHANGED");
          uint point=text[i];
          if(Char.IsHighSurrogate(text[i]) && i+1<text.Length && Char.IsLowSurrogate(text[i+1])) { point=(uint)Char.ConvertToUtf32(text[i],text[i+1]); i++; }
          if(SendMessageTimeoutW(gui.focus,0x0109,new UIntPtr(point),new IntPtr(1),0x22,500,out answer)==IntPtr.Zero) throw new Exception("COMPUTER_INPUT_REJECTED");
          delivered++;
        }
      } catch { if(delivered>0) throw new Exception("COMPUTER_INPUT_REJECTED"); throw; }
      return "unicode_message";
    }
    Input[] a=new Input[text.Length*2];
    for(int i=0;i<text.Length;i++){ a[i*2]=Key(0,text[i],4); a[i*2+1]=Key(0,text[i],6); }
    Ready(foreground.ToInt64().ToString(),inputTick);
    Send(a);
    return "unicode_input";
  }
  public static void Keys(ushort[] keys) {
    Input[] a=new Input[keys.Length*2];
    for(int i=0;i<keys.Length;i++){ a[i]=Key(keys[i],0,0); a[a.Length-1-i]=Key(keys[i],0,2); }
    Send(a);
  }
  public static void Click(bool right,int count,int x,int y) {
    IntPtr target=WindowFromPoint(new Point{x=x,y=y});
    if(target==IntPtr.Zero || GetAncestor(target,3)!=GetAncestor(GetForegroundWindow(),3)) throw new Exception("COMPUTER_TARGET_OCCLUDED");
    if(!SetCursorPos(x,y)) throw new Exception("COMPUTER_POINTER_REJECTED");
    Input[] a=new Input[count*2];
    for(int i=0;i<count;i++){a[i*2]=new Input{data=new Union{mouse=new Mouse{flags=(uint)(right?8:2)}}};a[i*2+1]=new Input{data=new Union{mouse=new Mouse{flags=(uint)(right?16:4)}}};}
    Send(a);
  }
  public static void Hover(int x,int y) {
    IntPtr target=WindowFromPoint(new Point{x=x,y=y});
    if(target==IntPtr.Zero || GetAncestor(target,3)!=GetAncestor(GetForegroundWindow(),3)) throw new Exception("COMPUTER_TARGET_OCCLUDED");
    if(!SetCursorPos(x,y)) throw new Exception("COMPUTER_POINTER_REJECTED");
  }
  static Input AbsoluteMove(int x,int y,int left,int top,int width,int height) {
    return new Input{data=new Union{mouse=new Mouse{x=(int)Math.Round(((double)x-left)*65535/(width-1)),y=(int)Math.Round(((double)y-top)*65535/(height-1)),flags=0xe001}}};
  }
  public static Input[] DragInputs(int fromX,int fromY,int toX,int toY,int left,int top,int width,int height) {
    if(width<=1 || height<=1 || (long)fromX<left || (long)toX<left || (long)fromY<top || (long)toY<top ||
       (long)fromX>=(long)left+width || (long)toX>=(long)left+width || (long)fromY>=(long)top+height || (long)toY>=(long)top+height)
      throw new Exception("COMPUTER_COORDS_INVALID");
    var a=new Input[11];
    a[0]=AbsoluteMove(fromX,fromY,left,top,width,height);
    a[1]=new Input{data=new Union{mouse=new Mouse{flags=2}}};
    for(int i=1;i<=8;i++) a[i+1]=AbsoluteMove((int)Math.Round(fromX+((double)toX-fromX)*i/8),(int)Math.Round(fromY+((double)toY-fromY)*i/8),left,top,width,height);
    a[10]=new Input{data=new Union{mouse=new Mouse{flags=4}}};
    return a;
  }
  public static void Drag(int fromX,int fromY,int toX,int toY,string expected,string tick) {
    Input[] inputs=DragInputs(fromX,fromY,toX,toY,GetSystemMetrics(76),GetSystemMetrics(77),GetSystemMetrics(78),GetSystemMetrics(79));
    IntPtr owner=GetAncestor(GetForegroundWindow(),3);
    for(int i=0;i<=8;i++) {
      Point p=new Point{x=(int)Math.Round(fromX+((double)toX-fromX)*i/8),y=(int)Math.Round(fromY+((double)toY-fromY)*i/8)};
      IntPtr target=WindowFromPoint(p);
      if(target==IntPtr.Zero || GetAncestor(target,3)!=owner) throw new Exception("COMPUTER_TARGET_OCCLUDED");
    }
    Ready(expected,tick);
    // Down, all moves and Up are queued together. No held button spans requests.
    Send(inputs);
  }
  public static void Wheel(int amount,bool horizontal) {
    Point point;
    if(!GetCursorPos(out point) || GetAncestor(WindowFromPoint(point),3)!=GetAncestor(GetForegroundWindow(),3)) throw new Exception("COMPUTER_TARGET_OCCLUDED");
    Send(new Input[]{new Input{data=new Union{mouse=new Mouse{flags=(uint)(horizontal?0x1000:0x0800),data=unchecked((uint)amount)}}}});
  }
}
'@

function Get-KosworkApps {
  if ($null -ne $script:kosworkAppCache) { return $script:kosworkAppCache }
  $result = @{}
  foreach ($name in @('notepad.exe','calc.exe','explorer.exe')) {
    $candidate = if ($name -eq 'explorer.exe') { Join-Path $env:WINDIR $name } else { Join-Path $env:WINDIR ('System32\' + $name) }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $result[$name] = @{ name=$name; path=$candidate; kind='exe' } }
  }
  foreach ($root in @('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths')) {
    if (Test-Path -LiteralPath $root) {
      foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Select-Object -First 200) {
        $name = $entry.PSChildName
        $candidate = [string]$entry.GetValue('')
        $candidate = $candidate.Trim('"')
        if ($name -match '^[a-zA-Z0-9_. -]+\.exe$' -and $candidate -match '^[A-Za-z]:\\.*\.exe$' -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
          $result[$name.ToLowerInvariant()] = @{ name=$name; path=$candidate; kind='exe' }
        }
      }
    }
  }
  if (Get-Command Get-StartApps -ErrorAction SilentlyContinue) {
    try {
      foreach ($entry in Get-StartApps | Select-Object -First 1000) {
        $appId = [string]$entry.AppID
        if ($appId -match '^[a-zA-Z0-9_.!{} -]{1,240}$') {
          $digest = [Security.Cryptography.SHA256]::Create()
          try { $opaque = ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($appId)))).Replace('-','').Substring(0,24).ToLowerInvariant() } finally { $digest.Dispose() }
          $result['start-' + $opaque] = @{ name=[string]$entry.Name; app_id=$appId; kind='start' }
        }
      }
    } catch { }
  }
  $script:kosworkAppCache = $result
  return $result
}

function Get-KosworkState {
  [KosworkNative]::Ready('','')
  $script:windowResults = [Collections.Generic.List[object]]::new()
  $callback = [KosworkNative+EnumProc] {
    param($handle, $parameter)
    if ($script:windowResults.Count -ge 80) { return $false }
    if ([KosworkNative]::IsWindowVisible($handle)) {
      $title = [Text.StringBuilder]::new(513)
      [void][KosworkNative]::GetWindowText($handle, $title, 513)
      if ($title.Length -gt 0) {
        [uint32]$windowProcess = 0
        [void][KosworkNative]::GetWindowThreadProcessId($handle, [ref]$windowProcess)
        $script:windowResults.Add(@{ id=$handle.ToInt64().ToString(); title=$title.ToString(); process_id=$windowProcess })
      }
    }
    return $true
  }
  [void][KosworkNative]::EnumWindows($callback, [IntPtr]::Zero)
  $foreground = [KosworkNative]::GetForegroundWindow()
  $elements = [Collections.Generic.List[object]]::new()
  try {
    $root = [Windows.Automation.AutomationElement]::FromHandle($foreground)
    $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = [Collections.Generic.Queue[object]]::new()
    $queue.Enqueue($root)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($queue.Count -gt 0 -and $elements.Count -lt 120 -and $clock.ElapsedMilliseconds -lt 1200) {
      $element = $queue.Dequeue()
      $current = $element.Current
      if (-not $current.IsPassword) {
        $name = [string]$current.Name
        if ($name.Length -gt 180) { $name = $name.Substring(0,180) }
        if ($name.Length -gt 0) { $elements.Add(@{name=$name; type=$current.ControlType.ProgrammaticName}) }
      }
      $child = $walker.GetFirstChild($element)
      $children = 0
      while ($null -ne $child -and $children -lt 100 -and $queue.Count -lt 200 -and $clock.ElapsedMilliseconds -lt 1200) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
        $children++
      }
    }
  } catch { }
  return @{ active_window=$foreground.ToInt64().ToString(); input_tick=[KosworkNative]::InputTick(); windows=@($script:windowResults.ToArray()); elements=@($elements.ToArray()); known_folders=@{ desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory) } }
}

while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    if ($line.Length -gt 32000) { throw 'COMPUTER_REQUEST_TOO_LARGE' }
    $request = $line | ConvertFrom-Json
    [KosworkNative]::Ready([string]$request.expected_window,[string]$request.expected_input_tick)
    switch ($request.kind) {
      'state' { $value = Get-KosworkState }
      'foreground' { $value = @{ active_window=[KosworkNative]::GetForegroundWindow().ToInt64().ToString(); input_tick=[KosworkNative]::InputTick() } }
      'apps' {
        $apps = Get-KosworkApps
        $query = [string]$request.query
        $items = @($apps.Keys | Sort-Object | ForEach-Object { @{ id=$_; name=[string]$apps[$_].name } } | Where-Object {
          -not $query -or $_.name.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.id.IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0
        })
        $value = @{ apps=@($items | Select-Object -First 80); omitted=[Math]::Max(0,$items.Count-80) }
      }
      'launch' {
        $apps = Get-KosworkApps
        if (-not $apps.ContainsKey([string]$request.app_id)) { throw 'COMPUTER_APP_NOT_FOUND' }
        $target = $apps[[string]$request.app_id]
        if ($target.kind -eq 'start') {
          $process = Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList @('shell:AppsFolder\' + $target.app_id) -PassThru
        } else { $process = Start-Process -FilePath $target.path -PassThru }
        $value = @{ requested=$true; process_id=$process.Id }
      }
      'focus' {
        $handle = [IntPtr]::new([long]$request.window_id)
        if (-not [KosworkNative]::IsWindow($handle) -or -not [KosworkNative]::IsWindowVisible($handle)) { throw 'COMPUTER_WINDOW_NOT_FOUND' }
        [KosworkNative]::Focus($handle)
        $value = @{ requested=$true }
      }
      'click' { [KosworkNative]::Click([bool]$request.right,[int]$request.count,[int]$request.x,[int]$request.y); $value=@{requested=$true} }
      'hover' { [KosworkNative]::Hover([int]$request.x,[int]$request.y); $value=@{requested=$true} }
      'drag' { [KosworkNative]::Drag([int]$request.from_x,[int]$request.from_y,[int]$request.to_x,[int]$request.to_y,[string]$request.expected_window,[string]$request.expected_input_tick); $value=@{requested=$true} }
      'text' { $inputMethod=[KosworkNative]::Text([string]$request.text,[string]$request.expected_window,[string]$request.expected_input_tick); $value=@{requested=$true; input_method=$inputMethod} }
      'keys' { [KosworkNative]::Keys([uint16[]]$request.codes); $value=@{requested=$true} }
      'wheel' { [KosworkNative]::Wheel([int]$request.amount,[bool]$request.horizontal); $value=@{requested=$true} }
      default { throw 'COMPUTER_REQUEST_INVALID' }
    }
    @{id=$request.id; ok=$true; result=$value} | ConvertTo-Json -Compress -Depth 8 | ForEach-Object { [Console]::WriteLine($_) }
  } catch {
    $code = 'COMPUTER_NATIVE_ERROR'
    if ($_.Exception.Message -match 'COMPUTER_[A-Z_]+') { $code=$Matches[0] }
    @{id=$request.id; ok=$false; error=$code; diagnostic=@{stage=[string]$request.kind; line=$_.InvocationInfo.ScriptLineNumber; exception_type=$_.Exception.GetType().FullName}} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
  }
}
