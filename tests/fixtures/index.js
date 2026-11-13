/* In-memory Unity sample project used by the test suite and browser smoke test. */
'use strict';

var G = {
  gameManager: '11111111111111111111111111111111',
  playerController: '22222222222222222222222222222222',
  healthAsset: '33333333333333333333333333333333',
  healthData: '44444444444444444444444444444444',
  hudView: '55555555555555555555555555555555',
  playerPrefab: '77777777777777777777777777777777',
  mainScene: '88888888888888888888888888888888',
  gameRoot: 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0',
  dataBinder: 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
  g1State: 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
  g1DataBase: 'e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3',
  g1View: 'e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4'
};

function meta(guid, importer) {
  return 'fileFormatVersion: 2\nguid: ' + guid + '\n' + (importer || 'MonoImporter') +
    ':\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n';
}

var FILES = {};

FILES['Assets/Scripts/Core/GameManager.cs'] = [
  'using UnityEngine;',
  'using UnityEngine.Events;',
  'using Battle.Player;',
  '',
  'namespace Battle.Core',
  '{',
  '    [DisallowMultipleComponent]',
  '    public class GameManager : MonoBehaviour',
  '    {',
  '        public static GameManager Instance { get; private set; }',
  '        [SerializeField] private PlayerController player;',
  '        [SerializeField] private HealthData defaultHealth;',
  '        public UnityEvent onGameOver = new UnityEvent();',
  '',
  '        private void Start()',
  '        {',
  '            // runtime component lookup',
  '            player = GetComponent<PlayerController>();',
  '        }',
  '',
  '        public void Restart(int level = 0)',
  '        {',
  '            player.TakeDamage(level);',
  '            onGameOver?.Invoke();',
  '        }',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Core/GameManager.cs.meta'] = meta(G.gameManager);

FILES['Assets/Scripts/Player/PlayerController.cs'] = [
  'using UnityEngine;',
  'using UnityEngine.Events;',
  'using System.Collections;',
  'using System.Collections.Generic;',
  'using Battle.Core;',
  'using Battle.Data;',
  '',
  'namespace Battle.Player',
  '{',
  '    public interface IDamageable',
  '    {',
  '        void ApplyDamage(int amount);',
  '    }',
  '',
  '    [RequireComponent(typeof(Rigidbody))]',
  '    public class PlayerController : MonoBehaviour, IDamageable',
  '    {',
  '        [SerializeField] private int hp = 100;',
  '        [SerializeField] private HealthData config;',
  '        public UnityEvent<int> onDeath;',
  '        public List<GameManager> observers = new List<GameManager>();',
  '        public HealthData[] configList = new HealthData[0];',
  '        public Dictionary<string, HealthData> configMap = new Dictionary<string, HealthData>();',
  '        public List<Stats> stats = new List<Stats>();',
  '        public int Hp { get => hp; set => hp = value; }',
  '',
  '        public void TakeDamage(int amount)',
  '        {',
  '            hp -= amount;',
  '        }',
  '',
  '        public void ApplyDamage(int amount)',
  '        {',
  '            TakeDamage(amount);',
  '        }',
  '',
  '        public IEnumerator Respawn(GameManager manager)',
  '        {',
  '            yield return null;',
  '        }',
  '',
  '        public class Stats',
  '        {',
  '            public int kills;',
  '        }',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Player/PlayerController.cs.meta'] = meta(G.playerController);

FILES['Assets/Scripts/Data/HealthData.cs'] = [
  'using UnityEngine;',
  '',
  'namespace Battle.Data',
  '{',
  '    [CreateAssetMenu(menuName = "Battle/Health")]',
  '    public class HealthData : ScriptableObject',
  '    {',
  '        public int maxHp = 100;',
  '        [SerializeField] private AnimationCurve regenCurve;',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Data/HealthData.cs.meta'] = meta(G.healthData);

FILES['Assets/Scripts/UI/HudView.cs'] = [
  'using UnityEngine;',
  'using Battle.Player;',
  'using Battle.Core;',
  '',
  'namespace Battle.UI',
  '{',
  '    public class HudView : MonoBehaviour',
  '    {',
  '        [SerializeField] private PlayerController player;',
  '        [SerializeField] private GameManager manager;',
  '',
  '        private void Update() { }',
  '',
  '        private void OnEnable()',
  '        {',
  '            if (manager) manager.onGameOver += HandleGameOver;',
  '        }',
  '',
  '        private void OnDisable()',
  '        {',
  '            if (manager) manager.onGameOver -= HandleGameOver;',
  '        }',
  '',
  '        private void HandleGameOver() { }',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/UI/HudView.cs.meta'] = meta(G.hudView, 'MonoImporter');

FILES['Assets/Scripts/Core/GameRoot.cs'] = [
  'using UnityEngine;',
  'using Battle.Data;',
  '',
  'namespace Battle.Core',
  '{',
  '    public class GameRoot : MonoBehaviour',
  '    {',
  '        [SerializeField] private HealthData db;',
  '        [SerializeField] private DataBinder binder;',
  '',
  '        private void Start()',
  '        {',
  '            binder.Bind(db);',
  '        }',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Core/GameRoot.cs.meta'] = meta(G.gameRoot, 'MonoImporter');

FILES['Assets/Scripts/Data/DataBinder.cs'] = [
  'using UnityEngine;',
  'using Battle.Data;',
  '',
  'namespace Battle.Data',
  '{',
  '    public class DataBinder : MonoBehaviour',
  '    {',
  '        [SerializeField] private HealthData bound;',
  '',
  '        public void Bind(HealthData data)',
  '        {',
  '            bound = data;',
  '        }',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Data/DataBinder.cs.meta'] = meta(G.dataBinder, 'MonoImporter');

// Chain scenario (VS find-all-references): G1View subscribes to G1State.Changed
// through `db.State.Changed += Refresh` — a chained receiver that must resolve
// db → G1DataBase → State (G1State).
FILES['Assets/Scripts/Data/G1State.cs'] = [
  'using System;',
  '',
  'public class G1State',
  '{',
  '    public event Action Changed;',
  '    private int score;',
  '    public int Score',
  '    {',
  '        get { return score; }',
  '        set { score = value; }',
  '    }',
  '    public void Fire()',
  '    {',
  '        Changed?.Invoke();',
  '    }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Data/G1State.cs.meta'] = meta(G.g1State, 'MonoImporter');

FILES['Assets/Scripts/Data/G1DataBase.cs'] = [
  'using UnityEngine;',
  '',
  'public class G1DataBase : ScriptableObject',
  '{',
  '    public G1State State;',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/Data/G1DataBase.cs.meta'] = meta(G.g1DataBase, 'MonoImporter');

FILES['Assets/Scripts/UI/G1View.cs'] = [
  'using UnityEngine;',
  '',
  'public class G1View : MonoBehaviour',
  '{',
  '    public G1DataBase db;',
  '    private void OnEnable() { db.State.Changed += Refresh; }',
  '    private void OnDisable() { db.State.Changed -= Refresh; }',
  '    public void Refresh() { int s = db.State.Score; }',
  '}',
  ''
].join('\n');
FILES['Assets/Scripts/UI/G1View.cs.meta'] = meta(G.g1View, 'MonoImporter');

// AssemblyDefinition layering metadata: Core(0) → UI(1) → Data(2).
// Battle.Core references Battle.Data **by GUID** (Unity "Use GUIDs" mode) to
// prove guid → name resolution; the others use plain names.
FILES['Assets/Scripts/Data/Battle.Data.asmdef'] = JSON.stringify({ name: 'Battle.Data', references: [] }, null, 2);
FILES['Assets/Scripts/UI/Battle.UI.asmdef'] = JSON.stringify({ name: 'Battle.UI', references: ['Battle.Data'] }, null, 2);
FILES['Assets/Scripts/Core/Battle.Core.asmdef'] = JSON.stringify({ name: 'Battle.Core', references: ['f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6', 'Battle.UI'] }, null, 2);
FILES['Assets/Scripts/Data/Battle.Data.asmdef.meta'] = meta('f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6', 'AssemblyDefinitionImporter');
FILES['Assets/Scripts/UI/Battle.UI.asmdef.meta'] = meta('f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7', 'AssemblyDefinitionImporter');
FILES['Assets/Scripts/Core/Battle.Core.asmdef.meta'] = meta('f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8', 'AssemblyDefinitionImporter');

FILES['Assets/Prefabs/Player.prefab'] = [
  '%YAML 1.1',
  '%TAG !u! tag:unity3d.com,2011:',
  '--- !u!1 &100000',
  'GameObject:',
  '  m_ObjectHideFlags: 0',
  '  m_Name: PlayerRoot',
  '  m_Component:',
  '  - component: {fileID: 300000}',
  '  - component: {fileID: 350000}',
  '  - component: {fileID: 200000}',
  '--- !u!4 &300000',
  'Transform:',
  '  m_GameObject: {fileID: 100000}',
  '  m_LocalPosition: {x: 0, y: 1, z: 0}',
  '--- !u!54 &350000',
  'Rigidbody:',
  '  m_GameObject: {fileID: 100000}',
  '  m_Enabled: 1',
  '  m_Mass: 70',
  '--- !u!114 &200000',
  'MonoBehaviour:',
  '  m_GameObject: {fileID: 100000}',
  '  m_Enabled: 1',
  '  m_Script: {fileID: 11500000, guid: ' + G.playerController + ', type: 3}',
  '  hp: 100',
  '  config: {fileID: 11400000, guid: ' + G.healthAsset + ', type: 2}',
  ''
].join('\n');
FILES['Assets/Prefabs/Player.prefab.meta'] = meta(G.playerPrefab, 'PrefabImporter');

FILES['Assets/Data/DefaultHealth.asset'] = [
  '%YAML 1.1',
  '%TAG !u! tag:unity3d.com,2011:',
  '--- !u!114 &11400000',
  'MonoBehaviour:',
  '  m_Name: DefaultHealth',
  '  m_Script: {fileID: 11500000, guid: ' + G.healthData + ', type: 3}',
  '  maxHp: 100',
  ''
].join('\n');
FILES['Assets/Data/DefaultHealth.asset.meta'] = meta(G.healthAsset, 'NativeFormatImporter');

// 官方包脚本（Library/PackageCache）：m_Script 的 GUID 只存在于包内 .cs.meta，
// 用于验证组件清单解析出 EventSystem / StandaloneInputModule 等真实脚本名。
FILES['Library/PackageCache/com.unity.ugui@1.0.0/Runtime/EventSystem/EventSystem.cs.meta'] = meta('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'MonoImporter');
FILES['Library/PackageCache/com.unity.ugui@1.0.0/Runtime/Input/StandaloneInputModule.cs.meta'] = meta('a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'MonoImporter');

FILES['Assets/Scenes/Main.unity'] = [
  '%YAML 1.1',
  '%TAG !u! tag:unity3d.com,2011:',
  '--- !u!1 &500000',
  'GameObject:',
  '  m_Name: GameRoot',
  '  m_Component:',
  '  - component: {fileID: 500001}',
  '  - component: {fileID: 600000}',
  '--- !u!4 &500001',
  'Transform:',
  '  m_GameObject: {fileID: 500000}',
  '--- !u!114 &600000',
  'MonoBehaviour:',
  '  m_GameObject: {fileID: 500000}',
  '  m_Script: {fileID: 11500000, guid: ' + G.gameManager + ', type: 3}',
  '  playerPrefab: {fileID: 100100000, guid: ' + G.playerPrefab + ', type: 3}',
  '--- !u!1 &800000',
  'GameObject:',
  '  m_Name: EventSystem',
  '  m_Component:',
  '  - component: {fileID: 800001}',
  '  - component: {fileID: 800002}',
  '  - component: {fileID: 800003}',
  '--- !u!4 &800001',
  'Transform:',
  '  m_GameObject: {fileID: 800000}',
  '--- !u!114 &800002',
  'MonoBehaviour:',
  '  m_GameObject: {fileID: 800000}',
  '  m_Script: {fileID: 11500000, guid: a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1, type: 3}',
  '--- !u!114 &800003',
  'MonoBehaviour:',
  '  m_GameObject: {fileID: 800000}',
  '  m_Script: {fileID: 11500000, guid: a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2, type: 3}',
  '--- !u!1001 &700000',
  'PrefabInstance:',
  '  m_Modification:',
  '    m_TransformParent: {fileID: 500001}',
  '  m_SourcePrefab: {fileID: 100100000, guid: ' + G.playerPrefab + ', type: 3}',
  ''
].join('\n');
FILES['Assets/Scenes/Main.unity.meta'] = meta(G.mainScene, 'DefaultImporter');

function asFileArray() {
  return Object.keys(FILES).map(function (p) { return { path: p, content: FILES[p] }; });
}

module.exports = { FILES: FILES, GUIDS: G, asFileArray: asFileArray };
