/// Representa uma "comparacao": uma foto base e, opcionalmente, uma foto de
/// acompanhamento do mesmo objeto (perna, pe, etc.).
///
/// Na versao GRATUITA guardamos apenas o necessario localmente no aparelho:
/// caminhos das imagens, distancia registrada e os parametros de captura
/// usados na foto base, para reaproveitar na foto de acompanhamento e deixar
/// as duas imagens o mais semelhantes possivel.
class CaptureParams {
  final double exposureOffset;
  final double zoom;
  final bool flashOn;

  const CaptureParams({
    this.exposureOffset = 0.0,
    this.zoom = 1.0,
    this.flashOn = true,
  });

  Map<String, dynamic> toJson() => {
        'exposureOffset': exposureOffset,
        'zoom': zoom,
        'flashOn': flashOn,
      };

  factory CaptureParams.fromJson(Map<String, dynamic> json) => CaptureParams(
        exposureOffset: (json['exposureOffset'] as num?)?.toDouble() ?? 0.0,
        zoom: (json['zoom'] as num?)?.toDouble() ?? 1.0,
        flashOn: json['flashOn'] as bool? ?? true,
      );
}

class PhotoSession {
  final String id;
  final DateTime createdAt;

  /// Foto base (1a foto).
  final String basePhotoPath;
  final double baseDistanceCm;
  final CaptureParams baseParams;

  /// Foto de acompanhamento (2a foto) - pode ainda nao existir.
  final String? followUpPhotoPath;
  final double? followUpDistanceCm;
  final DateTime? followUpAt;

  const PhotoSession({
    required this.id,
    required this.createdAt,
    required this.basePhotoPath,
    required this.baseDistanceCm,
    required this.baseParams,
    this.followUpPhotoPath,
    this.followUpDistanceCm,
    this.followUpAt,
  });

  bool get hasFollowUp => followUpPhotoPath != null;

  PhotoSession copyWith({
    String? followUpPhotoPath,
    double? followUpDistanceCm,
    DateTime? followUpAt,
  }) {
    return PhotoSession(
      id: id,
      createdAt: createdAt,
      basePhotoPath: basePhotoPath,
      baseDistanceCm: baseDistanceCm,
      baseParams: baseParams,
      followUpPhotoPath: followUpPhotoPath ?? this.followUpPhotoPath,
      followUpDistanceCm: followUpDistanceCm ?? this.followUpDistanceCm,
      followUpAt: followUpAt ?? this.followUpAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'createdAt': createdAt.toIso8601String(),
        'basePhotoPath': basePhotoPath,
        'baseDistanceCm': baseDistanceCm,
        'baseParams': baseParams.toJson(),
        'followUpPhotoPath': followUpPhotoPath,
        'followUpDistanceCm': followUpDistanceCm,
        'followUpAt': followUpAt?.toIso8601String(),
      };

  factory PhotoSession.fromJson(Map<String, dynamic> json) => PhotoSession(
        id: json['id'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        basePhotoPath: json['basePhotoPath'] as String,
        baseDistanceCm: (json['baseDistanceCm'] as num).toDouble(),
        baseParams:
            CaptureParams.fromJson(json['baseParams'] as Map<String, dynamic>),
        followUpPhotoPath: json['followUpPhotoPath'] as String?,
        followUpDistanceCm: (json['followUpDistanceCm'] as num?)?.toDouble(),
        followUpAt: json['followUpAt'] == null
            ? null
            : DateTime.parse(json['followUpAt'] as String),
      );
}
