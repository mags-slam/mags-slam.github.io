"""
Build per-scene web 3D assets (decimated GLB mesh + trajectory JSON) for the
Interactive Viewer section. Mirrors the geometry conventions of
vis_tsdf_global.py: traj poses are in each agent's local frame and brought to
the global frame via the last submap's sim3 transform.

Run inside the `magsslam` conda env (open3d + trimesh + scipy required):

    conda activate magsslam
    python scripts/build_3d_assets.py
"""

import json
import os
from glob import glob

import numpy as np
import open3d as o3d
import trimesh
from scipy.spatial.transform import Rotation as R


# Same colors as vis_tsdf_global.py
AGENT_COLORS = [
    [0.0, 0.4, 1.0],   # blue
    [1.0, 0.2, 0.2],   # red
    [0.2, 0.8, 0.2],   # green
    [1.0, 0.6, 0.0],   # orange
    [0.6, 0.2, 0.8],   # purple
    [0.0, 0.8, 0.8],   # cyan
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MESH_OUT = os.path.join(REPO_ROOT, "static", "meshes")
TRAJ_OUT = os.path.join(REPO_ROOT, "static", "trajs")
os.makedirs(MESH_OUT, exist_ok=True)
os.makedirs(TRAJ_OUT, exist_ok=True)

# Override via environment if your local checkout lives elsewhere.
SLAM_OUTPUTS = os.environ.get("MAGSSLAM_OUTPUTS", os.path.expanduser("~/mags-slam/outputs"))

SCENES = [
    ("replica_apart0",       os.path.join(SLAM_OUTPUTS, "replica/multi_agent_apart0")),
    ("replica_apart1",       os.path.join(SLAM_OUTPUTS, "replica/multi_agent_apart1")),
    ("replica_office0",      os.path.join(SLAM_OUTPUTS, "replica/multi_agent_office0")),
    ("replica_plus_apart2",  os.path.join(SLAM_OUTPUTS, "replica_plus/apart2_multi_agent")),
    ("replica_plus_office2", os.path.join(SLAM_OUTPUTS, "replica_plus/office2_multi_agent")),
    ("eth3d_plant_scene",    os.path.join(SLAM_OUTPUTS, "eth3d/eth3d_multi_agent_plant_scene")),
    ("tnt_truck",            os.path.join(SLAM_OUTPUTS, "tnt/tnt_multi_agent_truck")),
]

TARGET_TRIANGLES = 150_000
MAX_TRAJ_POINTS = 600


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
        return np.array([0, 0, 0, 0, 0, 0, 1, 1], dtype=np.float64)
    last = sorted(sub.keys())[-1]
    return np.array(sub[last]["transform"], dtype=np.float64)


def export_mesh(in_ply, out_glb):
    mesh = o3d.io.read_triangle_mesh(in_ply)
    n_in = len(mesh.triangles)
    if n_in > TARGET_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(
            target_number_of_triangles=TARGET_TRIANGLES
        )
    mesh.compute_vertex_normals()

    verts = np.asarray(mesh.vertices, dtype=np.float32)
    tris = np.asarray(mesh.triangles, dtype=np.uint32)

    has_colors = len(mesh.vertex_colors) == len(mesh.vertices) and len(mesh.vertices) > 0
    if has_colors:
        cols = np.asarray(mesh.vertex_colors)
        cols = (cols * 255.0).clip(0, 255).astype(np.uint8)
        # trimesh expects RGBA
        rgba = np.hstack([cols, np.full((cols.shape[0], 1), 255, dtype=np.uint8)])
    else:
        rgba = None

    tm = trimesh.Trimesh(vertices=verts, faces=tris, vertex_colors=rgba, process=False)
    glb_bytes = tm.export(file_type="glb")
    with open(out_glb, "wb") as f:
        f.write(glb_bytes)
    return n_in, len(mesh.triangles)


def export_trajectories(result_dir, out_json):
    graph_path = os.path.join(result_dir, "submap_graph_state.json")
    with open(graph_path, "r") as f:
        graph = json.load(f)

    agents_out = []
    for agent_dir in sorted(glob(os.path.join(result_dir, "agent_*"))):
        try:
            aid = int(os.path.basename(agent_dir).split("_")[1])
        except ValueError:
            continue
        traj_path = os.path.join(agent_dir, "traj_full.txt")
        if not os.path.exists(traj_path):
            continue
        traj = np.loadtxt(traj_path)
        if traj.ndim == 1:
            traj = traj[None, :]
        sim3_mat = sim3_to_matrix(get_agent_sim3(graph, aid))
        stride = max(1, len(traj) // MAX_TRAJ_POINTS)
        rows = traj[::stride]
        pts = []
        for row in rows:
            T = sim3_mat @ to_se3(row)
            pts.append([float(T[0, 3]), float(T[1, 3]), float(T[2, 3])])
        agents_out.append({
            "id": aid,
            "color": AGENT_COLORS[aid % len(AGENT_COLORS)],
            "points": pts,
        })

    with open(out_json, "w") as f:
        json.dump({"agents": agents_out}, f)


def main():
    for name, result_dir in SCENES:
        ply = os.path.join(result_dir, "tsdf_mesh_global_w.ply")
        if not os.path.exists(ply):
            print(f"[skip] {name}: missing {ply}")
            continue
        out_glb = os.path.join(MESH_OUT, f"{name}.glb")
        out_json = os.path.join(TRAJ_OUT, f"{name}.json")
        print(f"[{name}]")
        n_in, n_out = export_mesh(ply, out_glb)
        glb_kb = os.path.getsize(out_glb) / 1024
        print(f"  mesh: {n_in:,} → {n_out:,} tris  |  {out_glb}  ({glb_kb:.1f} KB)")
        export_trajectories(result_dir, out_json)
        json_kb = os.path.getsize(out_json) / 1024
        print(f"  traj: {out_json}  ({json_kb:.1f} KB)")


if __name__ == "__main__":
    main()
