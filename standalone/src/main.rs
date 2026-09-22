#[cfg(windows)]
fn main() {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    unsafe {
        MessageBoxW(None, w!("SQL 工作台 独立壳已启动。业务模块正在迁移中。"), w!("roc_desk-sql"), MB_OK | MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
fn main() {
    println!("roc_desk-sql standalone shell");
    std::thread::park();
}
