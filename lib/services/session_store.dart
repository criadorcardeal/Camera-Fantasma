import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/photo_session.dart';

/// Armazenamento local simples para a versao gratuita.
///
/// - As imagens ficam em <documentos>/fotos/
/// - A lista de comparacoes fica em <documentos>/sessions.json
///
/// (Sem nuvem, sem nome/codigo nem banco por objeto - isso e da versao paga.)
class SessionStore {
  SessionStore._();
  static final SessionStore instance = SessionStore._();

  List<PhotoSession>? _cache;

  Future<Directory> _photosDir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(docs.path, 'fotos'));
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  Future<File> _indexFile() async {
    final docs = await getApplicationDocumentsDirectory();
    return File(p.join(docs.path, 'sessions.json'));
  }

  /// Move/copia uma imagem capturada (XFile temporario) para o
  /// armazenamento permanente do app e retorna o caminho final.
  Future<String> persistCapturedImage(String tempPath, String label) async {
    final dir = await _photosDir();
    final ext = p.extension(tempPath).isEmpty ? '.jpg' : p.extension(tempPath);
    final name =
        '${label}_${DateTime.now().millisecondsSinceEpoch}$ext';
    final dest = p.join(dir.path, name);
    await File(tempPath).copy(dest);
    return dest;
  }

  Future<List<PhotoSession>> loadAll() async {
    if (_cache != null) return _cache!;
    final file = await _indexFile();
    if (!await file.exists()) {
      _cache = [];
      return _cache!;
    }
    try {
      final raw = await file.readAsString();
      final list = (jsonDecode(raw) as List)
          .map((e) => PhotoSession.fromJson(e as Map<String, dynamic>))
          .toList();
      list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      _cache = list;
    } catch (_) {
      _cache = [];
    }
    return _cache!;
  }

  Future<void> _save() async {
    final file = await _indexFile();
    final data = (_cache ?? []).map((e) => e.toJson()).toList();
    await file.writeAsString(jsonEncode(data));
  }

  Future<void> upsert(PhotoSession session) async {
    final all = await loadAll();
    final idx = all.indexWhere((s) => s.id == session.id);
    if (idx >= 0) {
      all[idx] = session;
    } else {
      all.insert(0, session);
    }
    await _save();
  }

  Future<void> delete(PhotoSession session) async {
    final all = await loadAll();
    all.removeWhere((s) => s.id == session.id);
    await _save();
    // Remove arquivos de imagem associados.
    for (final path in [session.basePhotoPath, session.followUpPhotoPath]) {
      if (path == null) continue;
      final f = File(path);
      if (await f.exists()) {
        try {
          await f.delete();
        } catch (_) {}
      }
    }
  }
}
