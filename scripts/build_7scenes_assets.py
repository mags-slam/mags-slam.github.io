"""
Build per-agent + global GLB meshes (with matching trajectory JSONs) for the
"Why Multi-Agent SLAM?" section.

Per-agent meshes live in agent-local frame; we apply each agent's last-submap
sim3 from submap_graph_state.json to bring them into the global frame so that
all 5 GLBs share the same coordinate system. The combined `tsdf_mesh_w0.0001.ply`
(top level of the result dir) is already global.

Trajectories: for each agent_i view, write only that agent's polyline; for the
combined view, write all 4 agents.

Run:
    conda activate magsslam
    python scripts/build_7scenes_assets.py
"""

import json
import os
from glob import glob

import numpy as np
import open3d as o3d
import trimesh
from scipy.spatial.transform import Rotation as R


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MESH_OUT = os.path.join(REPO_ROOT, "static", "meshes")
TRAJ_OUT = os.path.join(REPO_ROOT, "static", "trajs")
os.makedirs(MESH_OUT, exist_ok=True)
os.makedirs(TRAJ_OUT, exist_ok=True)

SLAM_OUTPUTS = os.environ.get("MAGSSLAM_OUTPUTS", os.path.expanduser("~/mags-slam/outputs"))
RESULT_DIR = os.path.join(SLAM_OUTPUTS, "7scenes/fire")
GLOBAL_PLY = os.path.join(RESULT_DIR, "tsdf_mesh_w0.0001.ply")

TARGET_TRIANGLES = 200_000
MAX_TRAJ_POINTS = 600

AGENT_COLORS = [
    [0.0, 0.4, 1.0],   # blue
    [1.0, 0.2, 0.2],   # red
    [0.2, 0.8, 0.2],   # green
    [1.0, 0.6, 0.0],   # orange
]


def to_se3(pvec):
    pose = np.eye(4)
    pose[:3, :3] = R.from_quat(pvec[4:]).as_matrix()
    pose[:3, 3] = pvec[1:4]
    return pose


def sim3_to_matrix(sim3):
    t = np.asarray(sim3[:3], dtype=np.float64)
    quat = np.asarray(sim3[3:7], dtype=np.float64)
    quat = quat / max(np.linalg.norm(quat), 1e-12)
    scale = float(sim3[7])
    rot = R.from_quat(quat).as_matrix()
    M = np.eye(4, dtype=np.float64)
    M[:3, :3] = scale * rot
    M[:3, 3] = t
    return M


def get_agent_sim3(graph, agent_id):
    sub = {k: v for k, v in graph.items() if v["agent_id"] == agent_id}
    if not sub:
        return np.eye(4, dtype=np.float64)
    last = sorted(sub.keys())[-1]
    return sim3_to_matrix(np.array(sub[last]["transform"], dtype=np.float64))


def export_glb(mesh, out_path):
    if len(mesh.triangles) > TARGET_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=TARGET_TRIANGLES)
    mesh.compute_vertex_normals()
    verts = np.asarray(mesh.vertices, dtype=np.float32)
    tris = np.asarray(mesh.triangles, dtype=np.uint32)
    has_colors = len(mesh.vertex_colors) == len(mesh.vertices) and len(mesh.vertices) > 0
    rgba = None
    if has_colors:
        cols = (np.asarray(mesh.vertex_colors) * 255.0).clip(0, 255).astype(np.uint8)
        rgba = np.hstack([cols, np.full((cols.shape[0], 1), 255, dtype=np.uint8)])
    tm = trimesh.Trimesh(vertices=verts, faces=tris, vertex_colors=rgba, process=False)
    glb_bytes = tm.export(file_type="glb")
    with open(out_path, "wb") as f:
        f.write(glb_bytes)
    return len(mesh.triangles)


def load_agent_traj(agent_dir, sim3_mat):
    traj_path = os.path.join(agent_dir, "traj_full.txt")
    if not os.path.exists(traj_path):
        return []
    traj = np.loadtxt(traj_path)
    if traj.ndim == 1:
        traj = traj[None, :]
    stride = max(1, len(traj) // MAX_TRAJ_POINTS)
    rows = traj[::stride]
    pts = []
    for row in rows:
        T = sim3_mat @ to_se3(row)
        pts.append([float(T[0, 3]), float(T[1, 3]), float(T[2, 3])])
    return pts


def main():
    graph = json.load(open(os.path.join(RESULT_DIR, "submap_graph_state.json")))

    per_agent_traj = {}
    for aid in range(4):
        agent_dir = os.path.join(RESULT_DIR, f"agent_{aid}")
        sim3_mat = get_agent_sim3(graph, aid)

        in_ply = os.path.join(agent_dir, "tsdf_mesh_w0.0001.ply")
        if os.path.exists(in_ply):
            mesh = o3d.io.read_triangle_mesh(in_ply)
            mesh.transform(sim3_mat)
            out = os.path.join(MESH_OUT, f"7scenes_file_agent{aid + 1}.glb")
            n = export_glb(mesh, out)
            print(f"agent {aid} mesh -> {out}  ({n:,} tris, {os.path.getsize(out)/1024:.1f} KB)")

        pts = load_agent_traj(agent_dir, sim3_mat)
        per_agent_traj[aid] = pts

        agent_traj_json = {
            "agents": [{
                "id": aid,
                "color": AGENT_COLORS[aid % len(AGENT_COLORS)],
                "points": pts,
            }] if pts else []
        }
        out_json = os.path.join(TRAJ_OUT, f"7scenes_file_agent{aid + 1}.json")
        with open(out_json, "w") as f:
            json.dump(agent_traj_json, f)
        print(f"agent {aid} traj -> {out_json}  ({len(pts)} pts, {os.path.getsize(out_json)/1024:.1f} KB)")

    # combined / all
    if os.path.exists(GLOBAL_PLY):
        mesh = o3d.io.read_triangle_mesh(GLOBAL_PLY)
        out = os.path.join(MESH_OUT, "7scenes_file_all.glb")
        n = export_glb(mesh, out)
        print(f"all     mesh -> {out}  ({n:,} tris, {os.path.getsize(out)/1024:.1f} KB)")
    else:
        print(f"[skip all mesh] {GLOBAL_PLY} missing")

    all_traj = {
        "agents": [
            {"id": aid, "color": AGENT_COLORS[aid % len(AGENT_COLORS)], "points": pts}
            for aid, pts in per_agent_traj.items() if pts
        ]
    }
    out_json = os.path.join(TRAJ_OUT, "7scenes_file_all.json")
    with open(out_json, "w") as f:
        json.dump(all_traj, f)
    print(f"all     traj -> {out_json}  ({sum(len(p) for p in per_agent_traj.values())} total pts, {os.path.getsize(out_json)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
