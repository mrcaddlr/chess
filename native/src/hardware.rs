use serde::Serialize;

#[derive(Serialize)]
pub struct HardwareInfo {
    pub os: String,
    pub arch: String,
    pub logical_cpus: usize,
    pub memory_bytes: Option<u64>,
}

pub fn detect() -> HardwareInfo {
    HardwareInfo {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        logical_cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        memory_bytes: memory_bytes(),
    }
}

#[cfg(target_os = "linux")]
fn memory_bytes() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kb = text.lines().find_map(|line| {
        let mut p = line.split_whitespace();
        (p.next()? == "MemTotal:").then(|| p.next()?.parse::<u64>().ok()).flatten()
    })?;
    Some(kb * 1024)
}

#[cfg(not(target_os = "linux"))]
fn memory_bytes() -> Option<u64> { None }
