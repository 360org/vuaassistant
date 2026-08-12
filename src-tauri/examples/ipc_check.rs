//! Exercises the desktop ↔ engine seam for real, across processes:
//! this binary plays the channel-adapter side (exactly what the Tauri
//! commands call), while `scripts/engine-stub.mjs` plays the engine side.
//!
//!   VUA_ENGINE_DIR=../scripts/engine-stub.mjs cargo run --example ipc_check

use std::time::{Duration, Instant};
use vuaassistant_lib::runtime::{AgentConfig, Runtime};

fn main() {
    let dir = std::env::temp_dir().join("vua-ipc-check");
    let _ = std::fs::remove_dir_all(&dir);
    let runtime = Runtime::new(dir.clone()).expect("init runtime");

    // 1. Attach the engine (spawns `node $VUA_ENGINE_DIR`).
    let attached = runtime.spawn_engine().expect("spawn engine");
    assert!(attached, "no engine attached — set VUA_ENGINE_DIR");
    assert!(runtime.status().engine_running, "engine not running");
    println!("✓ engine attached");

    // 2. Materialize an agent group + skills for the engine.
    runtime
        .sync(
            &[AgentConfig {
                id: "erp-expert".into(),
                name: "ERP Expert".into(),
                description: "Understands your ERP data.".into(),
            }],
            Some(std::path::Path::new("../skills")),
        )
        .expect("sync");
    assert!(dir.join("groups/erp-expert/CLAUDE.md").exists());
    assert!(dir.join("skills/write-email/SKILL.md").exists());
    println!("✓ groups + skills materialized");

    // 3. Round-trip a chat message and an agent-group message.
    for (group, text) in [("main", "Hello engine"), ("erp-expert", "Tồn kho?")] {
        let sent = runtime.send(group, text, "{}").expect("send");
        let start = Instant::now();
        let reply = loop {
            let replies = runtime.receive(group, 0).expect("receive");
            if let Some(last) = replies.last() {
                break last.clone();
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "timed out waiting for engine reply to inbound #{sent}"
            );
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(reply.content.contains(text), "echo mismatch: {}", reply.content);
        assert_eq!(reply.group_id, group);
        println!("✓ round-trip on group \"{group}\": {}", reply.content);
    }

    runtime.stop_engine();
    assert!(!runtime.status().engine_running, "engine still running");
    println!("✓ engine stopped — IPC contract holds");
}
